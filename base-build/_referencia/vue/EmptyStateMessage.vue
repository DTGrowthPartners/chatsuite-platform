<script>
export default {
  props: {
    message: {
      type: String,
      required: true,
    },
  },
};
</script>

<template>
  <div class="flex items-center justify-center h-full w-full">
    <img
      class="pointer-events-none select-none w-[70rem] max-w-[90%] h-auto opacity-20 dark:opacity-25"
      src="dashboard/assets/images/dtgp-watermark.png"
      :alt="message"
    />
  </div>
</template>
