export type DiffRow =
	| { kind: "context"; text: string; before: number; after: number }
	| { kind: "add"; text: string; after: number }
	| { kind: "remove"; text: string; before: number }
	| { kind: "separator" };

export function diffLines(beforeText: string, afterText: string): DiffRow[] {
	const before = beforeText.split("\n");
	const after = afterText.split("\n");

	// LCS table — O(n*m) memory, fine for typical note sizes.
	const n = before.length;
	const m = after.length;
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	// Backtrack to produce rows.
	const rows: DiffRow[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (before[i] === after[j]) {
			rows.push({ kind: "context", text: before[i], before: i + 1, after: j + 1 });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			rows.push({ kind: "remove", text: before[i], before: i + 1 });
			i++;
		} else {
			rows.push({ kind: "add", text: after[j], after: j + 1 });
			j++;
		}
	}
	while (i < n) {
		rows.push({ kind: "remove", text: before[i], before: i + 1 });
		i++;
	}
	while (j < m) {
		rows.push({ kind: "add", text: after[j], after: j + 1 });
		j++;
	}

	return rows;
}

export function trimDiffContext(rows: DiffRow[], context: number): DiffRow[] {
	const changed = new Set<number>();
	rows.forEach((r, i) => { if (r.kind !== "context") changed.add(i); });
	if (changed.size === 0) return [];

	const keep = new Set<number>();
	changed.forEach((ci) => {
		for (let d = -context; d <= context; d++) {
			const idx = ci + d;
			if (idx >= 0 && idx < rows.length) keep.add(idx);
		}
	});

	const result: DiffRow[] = [];
	let lastKept = -1;
	for (let i = 0; i < rows.length; i++) {
		if (!keep.has(i)) continue;
		if (lastKept !== -1 && i > lastKept + 1) result.push({ kind: "separator" });
		result.push(rows[i]);
		lastKept = i;
	}
	return result;
}
