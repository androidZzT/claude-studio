import { describe, expect, it } from "vitest";

import { parseHarnessConfig } from "../src/index.js";

const baseConfig = `
name: demo
tools:
  - claude-code
canonical:
  instructions: ./AGENTS.md.template
`;

describe("reference projects schema", () => {
  it("accepts a full reference project declaration", () => {
    const config = parseHarnessConfig(`
${baseConfig}
reference_projects:
  description: test
  projects:
    proj_a:
      path: ../a
      git_url: ssh://git@example.com/a
      description: A
`);

    expect(config.reference_projects).toEqual({
      description: "test",
      projects: {
        proj_a: {
          path: "../a",
          git_url: "ssh://git@example.com/a",
          description: "A"
        }
      }
    });
  });

  it("rejects missing projects", () => {
    expect(() =>
      parseHarnessConfig(`
${baseConfig}
reference_projects:
  description: test
`)
    ).toThrow(/projects/i);
  });

  it("rejects empty projects", () => {
    expect(() =>
      parseHarnessConfig(`
${baseConfig}
reference_projects:
  projects: {}
`)
    ).toThrow(/at least one project|projects/i);
  });

  it("rejects missing project paths", () => {
    expect(() =>
      parseHarnessConfig(`
${baseConfig}
reference_projects:
  projects:
    proj_a:
      git_url: ssh://git@example.com/a
`)
    ).toThrow(/path/i);
  });

  it("accepts a project entry with only path", () => {
    const config = parseHarnessConfig(`
${baseConfig}
reference_projects:
  projects:
    proj_b:
      path: ../b
`);

    expect(config.reference_projects).toEqual({
      projects: {
        proj_b: {
          path: "../b"
        }
      }
    });
  });
});
