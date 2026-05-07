import { describe, expect, it } from "vitest";

import { parseHarnessConfig, renderReferenceProjectsDocument } from "../src/index.js";

const baseConfig = `
name: demo
tools:
  - claude-code
canonical:
  instructions: ./AGENTS.md.template
`;

describe("reference projects render", () => {
  it("renders projects in sorted key order", () => {
    const config = parseHarnessConfig(`
${baseConfig}
reference_projects:
  description: test
  projects:
    proj_b:
      path: ../b
    proj_a:
      path: ../a
      git_url: ssh://git@example.com/a
      description: A
`);

    expect(renderReferenceProjectsDocument(config)).toBe(`{
  "description": "test",
  "projects": {
    "proj_a": {
      "path": "../a",
      "git_url": "ssh://git@example.com/a",
      "description": "A"
    },
    "proj_b": {
      "path": "../b"
    }
  }
}
`);
  });

  it("prefers projects.references over legacy reference_projects", () => {
    const config = parseHarnessConfig(`
${baseConfig}
projects:
  references:
    machpro:
      path: ../machpro
      git_url: ssh://git@example.com/machpro
      description: Machpro
      optional: true
reference_projects:
  projects:
    legacy:
      path: ../legacy
`);

    expect(renderReferenceProjectsDocument(config)).toBe(`{
  "projects": {
    "machpro": {
      "path": "../machpro",
      "git_url": "ssh://git@example.com/machpro",
      "description": "Machpro"
    }
  }
}
`);
  });

  it("omits top-level description when absent", () => {
    const config = parseHarnessConfig(`
${baseConfig}
reference_projects:
  projects:
    proj_b:
      path: ../b
`);

    expect(renderReferenceProjectsDocument(config)).toBe(`{
  "projects": {
    "proj_b": {
      "path": "../b"
    }
  }
}
`);
  });
});
