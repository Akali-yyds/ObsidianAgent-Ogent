import { Platform } from "obsidian";

export function isMobile(): boolean {
	return Platform.isMobileApp;
}

export function isDesktop(): boolean {
	return Platform.isDesktopApp;
}
