import { NextRequest } from 'next/server';
import { getExecution } from '@studio-core/execution-engine';
import type { ExecutionEvent } from '@studio-core/execution-engine';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  const maybeRunner = getExecution(id);
  if (!maybeRunner) {
    return new Response(JSON.stringify({ success: false, error: `Execution not found: ${id}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Capture in a definite const so TS knows it's non-null inside callbacks
  const runner = maybeRunner;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send current state as initial event
      const state = runner.getState();
      const initEvent = `data: ${JSON.stringify({ type: 'init', state })}\n\n`;
      controller.enqueue(encoder.encode(initEvent));

      function onEvent(event: ExecutionEvent) {
        const sseData = `data: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(encoder.encode(sseData));
        } catch {
          // Stream closed
          cleanup();
        }

        // Close stream when execution completes
        if (
          event.type === 'execution-status' &&
          (event.overallStatus === 'completed' ||
            event.overallStatus === 'failed' ||
            event.overallStatus === 'cancelled')
        ) {
          // Send final state
          const finalState = runner.getState();
          const finalEvent = `data: ${JSON.stringify({ type: 'final', state: finalState })}\n\n`;
          try {
            controller.enqueue(encoder.encode(finalEvent));
            controller.close();
          } catch {
            // Already closed
          }
          cleanup();
        }
      }

      function cleanup() {
        runner.removeListener('event', onEvent);
      }

      runner.on('event', onEvent);

      // If execution is already done when connecting, send final state and close
      const currentStatus = state.status;
      if (['completed', 'failed', 'cancelled'].includes(currentStatus)) {
        const finalEvent = `data: ${JSON.stringify({ type: 'final', state })}\n\n`;
        try {
          controller.enqueue(encoder.encode(finalEvent));
          controller.close();
        } catch {
          // Stream error
        }
        cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
