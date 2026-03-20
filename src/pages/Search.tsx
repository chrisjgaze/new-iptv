import { Text, View, hexColor } from "@lightningtv/solid";
import { Column, VirtualGrid } from "@lightningtv/solid/primitives";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import Input from "../components/Input";
import { Keyboard, onKeyPressWhenKeyboardOpen } from "../components/Keyboard";
import { Thumbnail } from "../components";
import searchProvider from "../api/providers/search";
import { setGlobalBackground } from "../state";

const keyboardFormats = {
  uppercase: [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", { title: "Delete", keyId: "delete" }],
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L", { title: "Clear", keyId: "clear" }],
    ["Z", "X", "C", "V", "B", "N", "M", { title: ".", keyId: "." }, { title: "-", keyId: "-" }, { title: "shift", keyId: "shift" }],
    [{ title: "Space", keyId: "space" }, { title: "Search", keyId: "search" }]
  ],
  default: [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", { title: "Delete", keyId: "delete" }],
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l", { title: "Clear", keyId: "clear" }],
    ["z", "x", "c", "v", "b", "n", "m", { title: ".", keyId: "." }, { title: "-", keyId: "-" }, { title: "shift", keyId: "shift" }],
    [{ title: "Space", keyId: "space" }, { title: "Search", keyId: "search" }]
  ]
};

const SearchPage = () => {
  const navigate = useNavigate();
  const keyEvent = createSignal("");
  const querySignal = createSignal("");
  const [_keyEvent, setKeyEvent] = keyEvent;
  const [query] = querySignal;
  const [results, setResults] = createSignal<any[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [status, setStatus] = createSignal("Type at least 2 characters to search.");
  const [selectedTitle, setSelectedTitle] = createSignal("");
  let gridRef;
  let keyboardRef;
  let searchTimer;

  function updateBackground(item: any) {
    setSelectedTitle(item?.title || "");
    setGlobalBackground(item?.backdrop || 0x0b0b0fff);
  }

  async function runSearch(currentQuery: string) {
    const trimmed = currentQuery.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError("");
      setStatus("Type at least 2 characters to search.");
      setGlobalBackground(0x0b0b0fff);
      return;
    }

    setLoading(true);
    setError("");
    setStatus(`Searching for "${trimmed}"...`);
    try {
      const nextResults = await searchProvider(trimmed);
      setResults(nextResults);
      if (nextResults.length) {
        setStatus(`${nextResults.length} result${nextResults.length === 1 ? "" : "s"}`);
        updateBackground(nextResults[0]);
      } else {
        setStatus(`No results for "${trimmed}".`);
        setGlobalBackground(0x0b0b0fff);
      }
    } catch (searchError) {
      const message = searchError instanceof Error ? searchError.message : String(searchError);
      setResults([]);
      setError(message);
      setStatus("Search failed.");
      setGlobalBackground(0x0b0b0fff);
    } finally {
      setLoading(false);
    }
  }

  function queueSearch(currentQuery: string) {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      void runSearch(currentQuery);
    }, 350);
  }

  function navigateToItem(item: any) {
    if (!item?.href) return true;
    navigate(item.href);
    return true;
  }

  const onKeyboardEnter = (_event, _keyboard, key) => {
    if (typeof key.key === "string") {
      setKeyEvent(key.key);
      return true;
    }

    const keyId = String(key.key?.keyId || key.key?.title || "").toLowerCase();
    if (keyId === "search") {
      void runSearch(query());
      if (results().length) {
        gridRef?.setFocus();
      }
      return true;
    }

    if (keyId === "shift") {
      return false;
    }

    if (keyId) {
      setKeyEvent(keyId);
      return true;
    }

    return false;
  };

  createEffect(() => {
    queueSearch(query());
  });

  onMount(() => {
    setGlobalBackground(0x0b0b0fff);
  });

  onCleanup(() => {
    if (searchTimer) clearTimeout(searchTimer);
  });

  return (
    <View
      width={1920}
      height={1080}
      onKeyPress={(event) => onKeyPressWhenKeyboardOpen(setKeyEvent, event)}
    >
      <Text x={162} y={72} fontSize={54} fontWeight="bold">
        Search Database
      </Text>
      <Text x={162} y={128} fontSize={24} color={hexColor("b8c0cc")}>
        Search your local movie database and open a result directly.
      </Text>

      <Column x={162} y={200} gap={18} scroll="none">
        <Input width={760} valueSignal={querySignal} keyEvents={keyEvent} placeholder="Search movies" autofocus />
        <Text fontSize={24} color={loading() ? hexColor("ffcc66") : hexColor("d8dee9")}>
          {status()}
        </Text>
        <Show when={error()}>
          <Text fontSize={22} color={hexColor("ff7a7a")}>
            {error()}
          </Text>
        </Show>
        <Show when={selectedTitle()}>
          <Text fontSize={22} color={hexColor("66ffcc")}>
            {selectedTitle()}
          </Text>
        </Show>
        <Keyboard ref={keyboardRef} width={760} formats={keyboardFormats} onEnter={onKeyboardEnter} onDown={() => results().length && gridRef?.setFocus()} />
      </Column>

      <Show when={results().length}>
        <View x={980} y={150} width={780} height={820} clipping>
          <Text y={0} fontSize={30} fontWeight="bold">
            Results
          </Text>
          <VirtualGrid
            ref={gridRef}
            y={54}
            width={760}
            columns={3}
            rows={2}
            gap={32}
            buffer={1}
            each={results()}
            onUp={() => keyboardRef?.setFocus()}
            onSelectedChanged={(_index, _col, elm) => updateBackground(elm?.item)}
          >
            {(item) => <Thumbnail item={item()} onEnter={() => navigateToItem(item())} />}
          </VirtualGrid>
        </View>
      </Show>
    </View>
  );
};

export default SearchPage;
