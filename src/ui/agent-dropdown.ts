import { Menu } from "obsidian";

export interface AgentDropdownOption {
	value: string;
	text: string;
}

type ChangeListener = () => void;

// Keep the menu visually attached to the trigger while leaving enough room
// for the focus/hover boundary. This is 60% shorter than the previous 6px gap.
const DROPDOWN_MENU_GAP_PX = 2.4;

/**
 * Adapter around Obsidian's own Menu API for the compact composer controls.
 *
 * The previous implementation rendered a custom fixed-position popup inside
 * the view. Obsidian's document/focus handling could then treat the opening
 * pointer event as an outside click and immediately close it. Using the host
 * Menu keeps popup ownership, focus, and dismissal in one place while this
 * class preserves the select-like API used by ChatView.
 */
export class AgentDropdown {
	private readonly trigger: HTMLButtonElement;
	private readonly listeners = new Set<ChangeListener>();
	private readonly optionsList: AgentDropdownOption[] = [];
	private activeMenu: Menu | null = null;
	private readonly handleTriggerClick = (event: MouseEvent): void => {
		event.preventDefault();
		this.toggleMenu();
	};
	private readonly handleTriggerKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			this.openMenu();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			this.closeMenu();
		}
	};
	private currentValue = "";

	constructor(parent: HTMLElement, className: string, ariaLabel: string) {
		this.trigger = parent.createEl("button", {
			cls: `${className} open-agent-dropdown-trigger`,
			attr: {
				type: "button",
				"aria-label": ariaLabel,
				"aria-haspopup": "menu",
				"aria-expanded": "false",
			},
		});
		this.trigger.addEventListener("click", this.handleTriggerClick);
		this.trigger.addEventListener("keydown", this.handleTriggerKeyDown);
	}

	get value(): string {
		return this.currentValue;
	}

	set value(value: string) {
		this.currentValue = value;
		this.renderTrigger();
	}

	get options(): AgentDropdownOption[] {
		return [...this.optionsList];
	}

	add(option: HTMLOptionElement | AgentDropdownOption, index?: number): void {
		this.addOption(option.value, option.text, index);
	}

	addOption(value: string, text: string, index?: number): void {
		const item = { value, text };
		if (typeof index === "number" && index >= 0 && index < this.optionsList.length) this.optionsList.splice(index, 0, item);
		else this.optionsList.push(item);
		if (!this.currentValue) this.currentValue = value;
		this.renderTrigger();
	}

	remove(index: number): void {
		if (index < 0 || index >= this.optionsList.length) return;
		const removed = this.optionsList.splice(index, 1)[0];
		if (removed?.value === this.currentValue) this.currentValue = this.optionsList[0]?.value ?? "";
		this.renderTrigger();
	}

	addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
		if (type !== "change") return;
		this.listeners.add(() => {
			if (typeof listener === "function") listener(new Event("change"));
			else listener.handleEvent(new Event("change"));
		});
	}

	dispose(): void {
		this.closeMenu();
		this.trigger.removeEventListener("click", this.handleTriggerClick);
		this.trigger.removeEventListener("keydown", this.handleTriggerKeyDown);
	}

	private toggleMenu(): void {
		if (this.activeMenu) this.closeMenu();
		else this.openMenu();
	}

	private openMenu(): void {
		if (this.optionsList.length === 0) return;
		this.closeMenu();

		const rect = this.trigger.getBoundingClientRect();
		const menu = new Menu();
		menu.setNoIcon();
		menu.setUseNativeMenu(false);
		for (const option of this.optionsList) {
			menu.addItem((item) => {
				item
					.setTitle(option.text)
					.setChecked(option.value === this.currentValue)
					.onClick(() => this.select(option.value));
			});
		}
		menu.onHide(() => {
			if (this.activeMenu !== menu) return;
			this.activeMenu = null;
			this.trigger.setAttribute("aria-expanded", "false");
		});
		this.activeMenu = menu;
		this.trigger.setAttribute("aria-expanded", "true");
		menu.showAtPosition({
			x: Math.round(rect.left),
			y: Math.round(rect.bottom),
			width: Math.max(80, Math.round(rect.width)),
			overlap: false,
		});
		window.requestAnimationFrame(() => this.alignVisibleMenu(menu, rect));
	}

	private alignVisibleMenu(menu: Menu, triggerRect: DOMRect): void {
		if (this.activeMenu !== menu) return;
		const candidates = Array.from(document.querySelectorAll<HTMLElement>(".menu"))
			.filter((element) => element.offsetWidth > 0 && element.offsetHeight > 0);
		const menuElement = candidates[candidates.length - 1];
		if (!menuElement) return;

		const menuWidth = menuElement.offsetWidth;
		const menuHeight = menuElement.offsetHeight;
		const openAbove = triggerRect.top >= menuHeight + DROPDOWN_MENU_GAP_PX
			|| window.innerHeight - triggerRect.bottom < menuHeight + DROPDOWN_MENU_GAP_PX;
		const top = openAbove
			? triggerRect.top - menuHeight - DROPDOWN_MENU_GAP_PX
			: triggerRect.bottom + DROPDOWN_MENU_GAP_PX;
		const left = Math.max(
			DROPDOWN_MENU_GAP_PX,
			Math.min(triggerRect.left, window.innerWidth - menuWidth - DROPDOWN_MENU_GAP_PX),
		);
		menuElement.style.setProperty("position", "fixed", "important");
		menuElement.style.setProperty("left", `${left}px`, "important");
		menuElement.style.setProperty("top", `${Math.max(DROPDOWN_MENU_GAP_PX, top)}px`, "important");
		menuElement.style.setProperty("right", "auto", "important");
		menuElement.style.setProperty("bottom", "auto", "important");
		menuElement.style.setProperty("transform", "none", "important");
	}

	private closeMenu(): void {
		const menu = this.activeMenu;
		this.activeMenu = null;
		this.trigger.setAttribute("aria-expanded", "false");
		menu?.hide();
	}

	private select(value: string): void {
		if (!this.optionsList.some((option) => option.value === value)) return;
		const changed = this.currentValue !== value;
		this.currentValue = value;
		this.renderTrigger();
		this.closeMenu();
		if (changed) for (const listener of this.listeners) listener();
	}

	private renderTrigger(): void {
		const selected = this.optionsList.find((option) => option.value === this.currentValue);
		this.trigger.setText(selected?.text ?? this.currentValue);
	}
}
