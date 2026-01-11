<script lang="ts">
  import type { Snippet } from "svelte";

  type LayoutShellProps = {
    drawerOpen?: boolean;
    header?: Snippet;
    children?: Snippet;
  };

  let { drawerOpen = false, header, children }: LayoutShellProps = $props();
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
  <header
    class="sticky top-0 z-20 border-b border-ink/10 bg-[rgba(245,239,230,0.9)] backdrop-blur-md"
  >
    {@render header?.()}
  </header>
  <main
    class={`flex-1 min-h-0 overflow-hidden ${
      drawerOpen ? "mr-[calc(min(var(--drawer-width),92vw)+24px)]" : ""
    }`}
  >
    {@render children?.()}
  </main>
</div>
