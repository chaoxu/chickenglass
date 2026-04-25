import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { withRuntimeIssueCapture } from "./browser-health.mjs";

class FakePage extends EventEmitter {
  off(event, listener) {
    this.removeListener(event, listener);
    return this;
  }
}

function requestFailure(url, errorText = "net::ERR_FAILED") {
  return {
    failure: () => ({ errorText }),
    method: () => "GET",
    url: () => url,
  };
}

function responseStatus(status, url) {
  return {
    request: () => ({ method: () => "GET" }),
    status: () => status,
    url: () => url,
  };
}

describe("browser runtime issue capture", () => {
  it("captures unexpected request failures", async () => {
    const page = new FakePage();

    const result = await withRuntimeIssueCapture(page, async () => {
      page.emit("requestfailed", requestFailure("http://localhost:5173/assets/app.js"));
      return { pass: true };
    });

    expect(result.issues).toEqual([{
      source: "requestfailed",
      text: "GET http://localhost:5173/assets/app.js net::ERR_FAILED",
    }]);
  });

  it("captures unexpected HTTP error responses", async () => {
    const page = new FakePage();

    const result = await withRuntimeIssueCapture(page, async () => {
      page.emit("response", responseStatus(500, "http://localhost:5173/api/export"));
      return { pass: true };
    });

    expect(result.issues).toEqual([{
      source: "response",
      text: "500 GET http://localhost:5173/api/export",
    }]);
  });

  it("supports explicit network ignore lists and default aborted-request ignores", async () => {
    const page = new FakePage();

    const result = await withRuntimeIssueCapture(page, async () => {
      page.emit("requestfailed", requestFailure("http://localhost:5173/app", "net::ERR_ABORTED"));
      page.emit("response", responseStatus(404, "http://localhost:5173/missing-preview.pdf"));
      return { pass: true };
    }, {
      ignoreHttpStatuses: [/missing-preview\.pdf/u],
    });

    expect(result.issues).toEqual([]);
  });

  it("can disable network capture for diagnostics-only probes", async () => {
    const page = new FakePage();

    const result = await withRuntimeIssueCapture(page, async () => {
      page.emit("requestfailed", requestFailure("http://localhost:5173/assets/app.js"));
      page.emit("response", responseStatus(500, "http://localhost:5173/api/export"));
      return { pass: true };
    }, {
      captureNetwork: false,
    });

    expect(result.issues).toEqual([]);
  });
});
