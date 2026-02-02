import { createEffect, createSignal, onMount, Show } from "solid-js";
import { View, Text, ElementNode } from "@lightningtv/solid";
import { VirtualGrid } from "@lightningtv/solid/primitives";
import { useMatch } from "@solidjs/router";
import { setGlobalBackground } from "../state";
import theme from "theme";

const CATEGORIES_URL = "http://172.20.3.54:8000/categories";

const pageStyles = {
  width: 1920,
  height: 1080,
  color: 0x00000000
} as const;

const headerStyles = {
  x: 360,
  y: 90,
  fontSize: 54,
  fontWeight: 700,
  color: theme.textPrimary
} as const;

const subHeaderStyles = {
  x: 360,
  y: 155,
  fontSize: 22,
  color: theme.textSecondary
} as const;

const gridContainer = {
  x: 320,
  y: 230,
  width: 1500,
  height: 780,
  clipping: true
} as const;

const tileStyles = {
  width: 320,
  height: 160,
  borderRadius: 18,
  color: 0x0d0d12ff,
  border: { width: 2, color: 0x2b2b33ff },
  linearGradient: {
    angle: 2.6,
    colors: [0x1b1a2aff, 0x2b2736ff, 0x151520ff]
  },
  transition: {
    scale: { duration: 180, easing: "ease-in-out" },
    border: { duration: 180, easing: "ease-in-out" },
    color: { duration: 180, easing: "ease-in-out" }
  },
  $focus: {
    scale: 1.06,
    color: theme.primaryDark,
    border: { width: 3, color: theme.primaryLight }
  }
} as const;

const tileTextStyles = {
  fontSize: 28,
  fontWeight: 600,
  color: theme.textPrimary,
  contain: "width",
  width: 280,
  maxLines: 2,
  textAlign: "center",
  y: 52,
  x: 20
} as const;

const statusTextStyles = {
  x: 360,
  y: 260,
  fontSize: 26,
  color: theme.textSecondary
} as const;

type CategoryItem = { id: string; title: string };

function normalizeCategories(payload: unknown): CategoryItem[] {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.categories)
      ? (payload as any).categories
      : Array.isArray((payload as any)?.data)
        ? (payload as any).data
        : [];

  return raw
    .map((item, index): CategoryItem | null => {
      if (typeof item === "string") {
        return { id: toId(item, index), title: item };
      }
      if (typeof item === "number") {
        return { id: `category-${item}`, title: String(item) };
      }
      if (item && typeof item === "object") {
        const name =
          (item as any).name ||
          (item as any).title ||
          (item as any).category ||
          (item as any).label ||
          (item as any).category_name;
        const id = (item as any).id || (item as any).category_id;
        if (typeof name === "string" && name.trim().length) {
          return {
            id:
              typeof id === "string" || typeof id === "number"
                ? String(id)
                : toId(name, index),
            title: name
          };
        }
      }
      return null;
    })
    .filter((item): item is CategoryItem => Boolean(item));
}

function toId(name: string, index: number) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || `category-${index + 1}`;
}

const CategoryTile = (props) => {
  return (
    <View {...props} forwardStates style={tileStyles}>
      <Text style={tileTextStyles}>{props.item?.title}</Text>
    </View>
  );
};

const Categories = () => {
  const isActive = useMatch(() => "/categories");
  let root: ElementNode | undefined;

  onMount(() => {
    setGlobalBackground("#0b0b0f");
  });

  const [categories, setCategories] = createSignal<CategoryItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | undefined>();

  onMount(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(CATEGORIES_URL);
      if (!response.ok) {
        throw new Error(`Failed to load categories (${response.status})`);
      }
      const payload = await response.json();
      setCategories(normalizeCategories(payload));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setLoading(false);
    }
  });

  createEffect(() => {
    if (!root) return;
    const active = isActive();
    root.alpha = active ? 1 : 0;
    root.hidden = !active;
    root.display = active ? "flex" : "none";
    root.skipFocus = !active;
  });

  return (
    <Show when={isActive()} keyed>
      <View ref={root} style={pageStyles}>
        <Text style={headerStyles}>Categories</Text>
        <Text style={subHeaderStyles}>
          Browse all available movie categories
        </Text>

        {loading() ? (
          <Text style={statusTextStyles}>Loading categories...</Text>
        ) : error() ? (
          <Text style={statusTextStyles}>Could not load categories.</Text>
        ) : categories().length ? (
          <View {...gridContainer}>
            <VirtualGrid
              autofocus
              each={categories()}
              columns={4}
              rows={4}
              gap={36}
              buffer={2}
              itemWidth={320}
              itemHeight={160}
              scroll="always"
            >
              {(item) => <CategoryTile item={item()} />}
            </VirtualGrid>
          </View>
        ) : (
          <Text style={statusTextStyles}>No categories found.</Text>
        )}
      </View>
    </Show>
  );
};

export default Categories;
