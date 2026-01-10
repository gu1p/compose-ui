<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";

  export type Tone = "panel" | "muted";

  type SurfaceProps = HTMLAttributes<HTMLElement> & {
    tag?: keyof HTMLElementTagNameMap;
    tone?: Tone;
    padded?: boolean;
  };

  let {
    tag = "div",
    tone = "panel",
    padded = true,
    class: className = "",
    children,
    ...rest
  }: SurfaceProps = $props();

  const base = "rounded-2xl border border-ink/10 shadow-panel";
  const tones: Record<Tone, string> = {
    panel: "bg-panel",
    muted: "bg-panel2",
  };
</script>

<svelte:element
  this={tag}
  class={`${base} ${tones[tone]} ${padded ? "p-4" : ""} ${className}`}
  {...rest}
>
  {@render children?.()}
</svelte:element>
