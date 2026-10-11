<script lang="ts">
  let { size = 21 }: { size?: number } = $props();
</script>

<svg
  class="brand-mark-icon"
  viewBox="0 0 512 512"
  style:width={`${size / 15}rem`}
  style:height={`${size / 15}rem`}
  aria-hidden="true"
  focusable="false"
>
  <path
    fill="currentColor"
    d="M428.7 32 L256 32 A224 224 0 0 0 256 480 L456 480 A24 24 0 0 0 480 456 L480 376 A24 24 0 0 0 456 352 L256 352 A96 96 0 0 1 256 160 L320 160 L434.3 45.7 A8 8 0 0 0 428.7 32Z"
  />
  <path
    fill="#5b7bae"
    d="M480 83.3 L480 232 A24 24 0 0 1 456 256 L362 256 A10 10 0 0 1 352 246 L352 192 L466.3 77.7 A8 8 0 0 1 480 83.3Z"
  />
</svg>

<style>
  .brand-mark-icon {
    display: block;
    flex: none;
  }
</style>
