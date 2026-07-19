// Tiny global toast helper — call toast('message') or toast('oops', 'error') anywhere
export function toast(message, type = 'success') {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, type } }));
}
