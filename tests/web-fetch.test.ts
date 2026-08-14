import { beforeEach, describe, expect, it } from "vitest";
import { webFetchTool, validatePublicUrl } from "../src/tools/web-fetch";
import { requestUrlMock } from "./setup";

describe("web_fetch", () => {
	beforeEach(() => requestUrlMock.mockReset());

	it("blocks local and private URLs", () => {
		expect(validatePublicUrl("http://127.0.0.1:8080/admin").ok).toBe(false);
		expect(validatePublicUrl("http://192.168.1.5/page").ok).toBe(false);
		expect(validatePublicUrl("file:///C:/secret.txt").ok).toBe(false);
	});

	it("returns sanitized untrusted content and citation metadata", async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			text: "<html><title>Docs</title><script>steal()</script><article>Hello <b>world</b></article></html>",
			headers: { "content-type": "text/html" },
		});

		const result = await webFetchTool().run({ url: "https://example.com/docs" }, {});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toMatchObject({
			title: "Docs",
			url: "https://example.com/docs",
			domain: "example.com",
			untrusted: true,
		});
		expect((result.value as { content: string }).content).not.toContain("steal");
		expect((result.value as { content: string }).content).toContain("Hello world");
	});
});
