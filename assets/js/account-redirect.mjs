export function redirectAccount(view) {
  const destination = new URL('/account/', view.location.href);
  destination.hash = view.location.hash;
  view.location.replace(destination.href);
}
if (typeof window !== 'undefined') redirectAccount(window);
