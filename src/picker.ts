import { emitTo, listen } from "@tauri-apps/api/event";
import { KEYS, readJson, searchSkins, skinName, writeJson, type Skin } from "./skins";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} is missing from picker.html`);
  return found as T;
}

const current = element<HTMLElement>("current");
const favourite = element<HTMLButtonElement>("favourite");
const keep = element<HTMLInputElement>("keep");
const random = element<HTMLButtonElement>("random");
const search = element<HTMLFormElement>("search");
const query = element<HTMLInputElement>("query");
const status = element<HTMLElement>("status");
const results = element<HTMLUListElement>("results");

let shown: "favourites" | "search" = "favourites";
// What the status line says about the list, restored after a skin change.
let listStatus = "";

function setListStatus(text: string): void {
  listStatus = text;
  status.textContent = text;
}

const favourites = () => readJson<Skin[]>(KEYS.favourites, []);
const currentSkin = () => readJson<Skin | null>(KEYS.current, null);

function render(): void {
  const skin = currentSkin();
  current.textContent = skin ? skinName(skin) : "Base skin";
  const isFavourite = !!skin && favourites().some((f) => f.md5 === skin.md5);
  favourite.textContent = isFavourite ? "★ Favourite" : "☆ Favourite";
  favourite.setAttribute("aria-pressed", String(isFavourite));
  // The base skin and skins known only by md5 cannot be favourited.
  favourite.disabled = !skin?.download_url;
  keep.checked = readJson<boolean>(KEYS.keep, false);
  for (const button of results.querySelectorAll("button")) {
    button.setAttribute("aria-current", String(button.dataset.md5 === skin?.md5));
  }
}

function showSkins(skins: Skin[]): void {
  results.replaceChildren(
    ...skins.map((skin) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.md5 = skin.md5;
      button.title = skinName(skin);
      const image = document.createElement("img");
      image.src = skin.screenshot_url;
      image.alt = "";
      image.loading = "lazy";
      const name = document.createElement("span");
      name.textContent = skinName(skin);
      button.append(image, name);
      button.addEventListener("click", () => {
        status.textContent = `Loading ${skinName(skin)}…`;
        void emitTo("main", "pick-skin", skin);
      });
      const item = document.createElement("li");
      item.append(button);
      return item;
    }),
  );
  render();
}

function showFavourites(): void {
  shown = "favourites";
  const list = favourites();
  setListStatus(
    list.length
      ? "Favourites"
      : "No favourites yet. Search for a skin, or star the one you are wearing.",
  );
  showSkins(list);
}

search.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = query.value.trim();
  if (!text) {
    showFavourites();
    return;
  }
  shown = "search";
  status.textContent = "Searching…";
  searchSkins(text)
    .then((skins) => {
      if (query.value.trim() !== text) return;
      setListStatus(
        skins.length
          ? `${skins.length} approved skins for “${text}”`
          : `No approved skins for “${text}”`,
      );
      showSkins(skins);
    })
    .catch((error: unknown) => {
      status.textContent = `Search failed: ${String(error)}`;
    });
});

// Clearing the search box goes back to the favourites.
query.addEventListener("input", () => {
  if (!query.value.trim() && shown === "search") showFavourites();
});

favourite.addEventListener("click", () => {
  const skin = currentSkin();
  if (!skin) return;
  const list = favourites();
  const without = list.filter((f) => f.md5 !== skin.md5);
  writeJson(KEYS.favourites, without.length === list.length ? [skin, ...list] : without);
  if (shown === "favourites") showFavourites();
  else render();
});

keep.addEventListener("change", () => writeJson(KEYS.keep, keep.checked));

random.addEventListener("click", () => {
  status.textContent = "Picking a random skin…";
  void emitTo("main", "random-skin");
});

void listen("skin-changed", () => {
  status.textContent = listStatus;
  render();
});
void listen<string>("skin-error", ({ payload }) => {
  status.textContent = `Could not change the skin: ${payload}`;
});

showFavourites();
query.focus();
