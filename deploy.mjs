import { copyFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

function getVaultPath() {
	const localFile = new URL(".vault-path", import.meta.url).pathname;
	if (existsSync(localFile)) {
		return readFileSync(localFile, "utf8").trim();
	}
	const env = process.env.OBSIDIAN_VAULT;
	if (env) return env.trim();
	console.error(
		"Error: vault path not configured.\n" +
		"Either create a .vault-path file with the path to your Obsidian vault root,\n" +
		"or set the OBSIDIAN_VAULT environment variable."
	);
	process.exit(1);
}

const vault = getVaultPath();
const dest = join(vault, ".obsidian", "plugins", "open-agent");
mkdirSync(dest, { recursive: true });

for (const file of ["main.js", "styles.css", "manifest.json"]) {
	copyFileSync(file, join(dest, file));
	console.log(`  copied ${file} → ${dest}/`);
}
