// Generates an SVG data-URI avatar from a user's initials. The real
// API does not store or generate avatars, so the client derives one
// locally from the user's name after authenticating — purely a
// presentation concern, not part of the auth flow itself.
export function generateInitialsAvatar(name: string, isLight: boolean = false): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${isLight ? '#6366f1' : '#4338ca'}"/>
        <stop offset="100%" stop-color="${isLight ? '#a855f7' : '#7e22ce'}"/>
      </linearGradient>
    </defs>
    <circle cx="64" cy="64" r="64" fill="url(#grad)"/>
    <text x="50%" y="54%" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="44" font-weight="700" fill="#ffffff" dominant-baseline="middle" text-anchor="middle" letter-spacing="1">
      ${initials || 'TW'}
    </text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
