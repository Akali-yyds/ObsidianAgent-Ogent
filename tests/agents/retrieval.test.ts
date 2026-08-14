import { describe, expect, it } from "vitest";
import { retrieveEvidence } from "../../src/agents/retrieval";
import type { VaultAdapter, VaultFile, VaultFileCache } from "../../src/packs/vault-adapter";

describe("retrieveEvidence", () => {
	it("ignores frontmatter-only matches when ranking notes", async () => {
		const vault = createVault({
			"laureates/lawrence-bragg.md": `---
title: "Lawrence Bragg"
tags: [nobel-physics, wikipedia]
---

Lawrence Bragg shared the 1915 Nobel Prize in Physics with his father.
As of 2025, Bragg is the youngest ever Nobel laureate in physics, having received the award at the age of 25.
`,
			"laureates/malala-yousafzai.md": `---
title: "Malala Yousafzai"
tags: [nobel-physics, wikipedia]
---

Malala Yousafzai is the youngest Nobel Prize laureate in history, receiving the Peace Prize in 2014 at age 17.
`,
		});

		const result = await retrieveEvidence(vault, "Who is the youngest person to win the Nobel Prize in Physics, and at what age?");

		expect(result.notes[0]?.path).toBe("laureates/lawrence-bragg.md");
		expect(result.notes.map((note) => note.path)).toContain("laureates/malala-yousafzai.md");
	});

	it("prioritizes the physics-twice note over generic multiple-winner notes", async () => {
		const vault = createVault({
			"laureates/john-bardeen.md": `---
title: "John Bardeen"
tags: [nobel-physics, wikipedia]
---

John Bardeen is the only person to be awarded the Nobel Prize in Physics twice:
first in 1956 for the transistor and again in 1972 for the BCS theory of superconductivity.
`,
			"laureates/marie-curie.md": `---
title: "Marie Curie"
tags: [nobel-physics, wikipedia]
---

Marie Curie was the first person to win a Nobel Prize twice,
and the only person to win Nobel Prizes in two different scientific fields.
`,
		});

		const result = await retrieveEvidence(vault, "Has anyone won the Nobel Prize in Physics twice, and if so, for what?");

		expect(result.notes[0]?.path).toBe("laureates/john-bardeen.md");
	});

	it("prefers the first recipient note over later first-in-country winners", async () => {
		const vault = createVault({
			"laureates/wilhelm-röntgen.md": `---
title: "Wilhelm Röntgen"
tags: [nobel-physics, wikipedia]
---

In 1901, Röntgen became the first recipient of the Nobel Prize in Physics for the discovery of X-rays.
`,
			"laureates/albert-a-michelson.md": `---
title: "Albert A. Michelson"
tags: [nobel-physics, wikipedia]
---

In 1907, Michelson received the Nobel Prize in Physics, becoming the first American to win the prize in a science.
`,
		});

		const result = await retrieveEvidence(vault, "Who received the first Nobel Prize in Physics, and for what?");

		expect(result.notes[0]?.path).toBe("laureates/wilhelm-röntgen.md");
	});
});

it("retrieves Chinese notes without whitespace tokenization", async () => {
	const vault = createVault({
		"参考与项目介绍/关键字段解析.md": "# 关键字段解析\n\n详细解释 CLI、启动流程和执行流程。",
		"参考与项目介绍/Cloud Code源码详解.md": "# Cloud Code\n\n源码执行流程说明。",
		"其他/无关.md": "一份与字段和流程无关的记录。",
	});

	const result = await retrieveEvidence(vault, "关键字段解析 CLI 执行流程");

	expect(result.notes[0]?.path).toBe("参考与项目介绍/关键字段解析.md");
});

function createVault(filesByPath: Record<string, string>): VaultAdapter {
	const files = new Map<string, VaultFile>();
	const contents = new Map<string, string>();
	const caches = new Map<string, VaultFileCache>();

	for (const [path, content] of Object.entries(filesByPath)) {
		const file = {
			path,
			basename: path.split("/").pop()?.replace(/\.md$/i, "") ?? path,
		};
		files.set(path, file);
		contents.set(path, content);
		caches.set(path, { frontmatter: { tags: ["nobel-physics", "wikipedia"] } });
	}

	return {
		listMarkdownFiles: () => [...files.values()],
		getFile: (path) => files.get(path) ?? null,
		read: async (file) => {
			const content = contents.get(file.path);
			if (content == null) throw new Error(`Missing vault file: ${file.path}`);
			return content;
		},
		resolveLink: () => null,
		getResolvedLinks: () => ({}),
		getFileCache: (file) => caches.get(file.path) ?? null,
	};
}
