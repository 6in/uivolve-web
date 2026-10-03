import { SCREEN_CATEGORIES, SCREEN_CATALOG } from "./screen-catalog.js";
import { pageUrl } from "./page-router.js";

export function createScreenPicker({ list, select, baseUrl, onSelect }) {
  const document = list.ownerDocument;
  const links = new Map();
  let busy = true;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "画面を選択";
  placeholder.disabled = true;
  select.replaceChildren(placeholder);
  list.replaceChildren();
  for (const category of SCREEN_CATEGORIES) {
    const group = document.createElement("section");
    group.className = "sample-category";
    const heading = document.createElement("h3");
    heading.textContent = category.title;
    const items = document.createElement("ul");
    group.append(heading, items);
    const options = document.createElement("optgroup");
    options.label = category.title;
    for (const screen of SCREEN_CATALOG.filter((screen) => screen.category === category.id)) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.className = "sample-link";
      link.href = pageUrl(screen.id, baseUrl, baseUrl).href;
      const title = document.createElement("span");
      title.className = "sample-title";
      title.textContent = screen.label || screen.title;
      const description = document.createElement("span");
      description.className = "sample-description";
      description.textContent = screen.description;
      link.append(title, description);
      link.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        if (!busy) void onSelect(screen.id);
      });
      links.set(screen.id, link);
      item.append(link);
      items.append(item);
      const option = document.createElement("option");
      option.value = screen.id;
      option.textContent = screen.title;
      options.append(option);
    }
    list.append(group);
    select.append(options);
  }
  return {
    setState({ id, disabled }) {
      busy = disabled;
      list.setAttribute("aria-busy", String(busy));
      select.value = links.has(id) ? id : "";
      for (const [screenId, link] of links) {
        if (screenId === id) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
        if (busy) {
          link.setAttribute("aria-disabled", "true");
          link.tabIndex = -1;
        } else {
          link.removeAttribute("aria-disabled");
          link.removeAttribute("tabindex");
        }
      }
    },
  };
}
