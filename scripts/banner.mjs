// Generates banner.svg: a GitHub profile banner styled after adamhlt.com.
// Zero dependencies (Node >= 18). Usage: GITHUB_TOKEN=... node scripts/banner.mjs [out.svg]
// Also writes the portrait variant next to it (banner-mobile.svg).
import { mkdir, readFile, writeFile } from "node:fs/promises";

const LOGIN = process.env.BANNER_LOGIN || "adamhlt";
const TOKEN = process.env.GITHUB_TOKEN || "";
const OUT = process.argv[2] || "banner.svg";

// Static profile info, mirrored from adamhlt.com
const PROFILE = {
  name: "Adam Henault",
  site: "adamhlt.com",
  headline: ["Secrets Leak", "Through Silicon"],
  tagline: [
    [["Hardware security", 1], [" PhD student: ", 0], ["chips, FPGAs", 1], [" and the", 0]],
    [["attacks that break them. Also ", 0], ["reverse engineering", 1], [",", 0]],
    [["CTFs", 1], [", ", 0], ["game hacking", 1], [" and ", 0], ["Windows internals", 1], [".", 0]],
  ],
  venues: ["SSTIC", "DSD", "HS3"],
};

// Design tokens from adamhlt.com :root
const C = {
  bg: "#060607", panel: "#0a0a0c", line: "#1c1c21", text: "#ececec",
  muted: "#7f7f87", dot: "230,230,235", accent: "255,62,48",
};

// Two layouts: desktop (landscape) and mobile (portrait), swapped by <picture> in the README
const LAYOUTS = {
  desktop: {
    W: 1000, H: 524, PAD: 40, pillY: 32, head: { size: 58, y: [160, 220] }, tag: { size: 12.5, y: 262, step: 21 },
    venuesY: 332, panel: { x: 600, y: 136, w: 360, h: 172 }, heat: { y: 388, weeks: 53, label: "LAST 12 MONTHS" },
  },
  mobile: {
    W: 480, H: 680, PAD: 24, pillY: 24, head: { size: 46, y: [130, 178] }, tag: { size: 12, y: 222, step: 20 },
    venuesY: 290, panel: { x: 24, y: 316, w: 432, h: 172 }, heat: { y: 536, weeks: 26, label: "LAST 6 MONTHS" },
  },
};

// ---------- data ----------

const gh = (url, opts = {}) =>
  fetch(url, {
    ...opts,
    headers: {
      "User-Agent": "adamhlt-banner",
      ...(TOKEN ? { Authorization: `bearer ${TOKEN}` } : {}),
      ...opts.headers,
    },
  });

async function fromGraphQL() {
  const query = `query($login:String!){user(login:$login){
    avatarUrl(size:96) followers{totalCount}
    repositories(ownerAffiliations:OWNER,isFork:false,privacy:PUBLIC,first:100){totalCount nodes{
      stargazerCount}}
    contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount contributionLevel}}}}
  }}`;
  const res = await gh("https://api.github.com/graphql", {
    method: "POST",
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  const u = json.data.user;
  const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
  const cal = u.contributionsCollection.contributionCalendar;
  return {
    avatarUrl: u.avatarUrl,
    followers: u.followers.totalCount,
    repos: u.repositories.totalCount,
    stars: u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0),
    contributions: cal.totalContributions,
    weeks: cal.weeks.map((w) => w.contributionDays.map((d) => ({ date: d.date, level: LEVELS[d.contributionLevel] }))),
  };
}

// Token-less fallback (local previews): public REST API + contributions page
async function fromPublic() {
  const user = await (await gh(`https://api.github.com/users/${LOGIN}`)).json();
  const repos = await (await gh(`https://api.github.com/users/${LOGIN}/repos?per_page=100&type=owner`)).json();
  if (!Array.isArray(repos)) throw new Error(JSON.stringify(repos));
  const own = repos.filter((r) => !r.fork);
  const html = await (await gh(`https://github.com/users/${LOGIN}/contributions`)).text();
  const days = [...html.matchAll(/data-date="([\d-]+)"[^>]*data-level="(\d)"/g)]
    .map((m) => ({ date: m[1], level: +m[2] }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const weeks = [];
  for (const d of days) {
    if (!weeks.length || new Date(d.date + "T00:00:00Z").getUTCDay() === 0) weeks.push([]);
    weeks.at(-1).push(d);
  }
  const total = html.match(/([\d,]+)\s+contributions?\s+in the last year/);
  return {
    avatarUrl: user.avatar_url + "&s=96",
    followers: user.followers,
    repos: own.length,
    stars: own.reduce((s, r) => s + r.stargazers_count, 0),
    contributions: total ? +total[1].replace(/,/g, "") : 0,
    weeks,
  };
}

async function dataUri(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const type = res.headers.get("content-type") || "image/png";
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

// Cropped portrait from adamhlt.com, downloaded into the repo (assets/avatar.webp).
// The site sits behind Cloudflare, which may block CI runners: in that case the
// last downloaded copy is used.
const AVATAR_FILE = "assets/avatar.webp";
const BROWSER = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  Accept: "text/html,image/avif,image/webp,*/*",
};

async function downloadSiteAvatar() {
  const base = `https://${PROFILE.site}/`;
  const page = await fetch(base, { headers: BROWSER });
  if (!page.ok) throw new Error(`${page.status} ${base}`);
  const src = (await page.text()).match(/<img[^>]+src="([^"]*avatar[^"]*)"/i)?.[1];
  if (!src) throw new Error("avatar not found on site");
  const img = await fetch(new URL(src, base), { headers: BROWSER });
  if (!img.ok || !img.headers.get("content-type")?.startsWith("image/")) throw new Error(`${img.status} ${src}`);
  await mkdir("assets", { recursive: true });
  await writeFile(AVATAR_FILE, Buffer.from(await img.arrayBuffer()));
}

async function siteAvatar() {
  await downloadSiteAvatar().catch((e) => console.warn(`site avatar download failed (${e.message}), using ${AVATAR_FILE}`));
  return `data:image/webp;base64,${(await readFile(AVATAR_FILE)).toString("base64")}`;
}

// Google Fonts subset (only the glyphs used), inlined so it renders inside <img>
async function embedFonts(text) {
  const chars = encodeURIComponent([...new Set(text)].join(""));
  const css = [];
  for (const fam of ["Space+Grotesk:wght@400;500", "JetBrains+Mono:wght@400;500"]) {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${fam}&text=${chars}&display=block`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
    });
    let sheet = await res.text();
    for (const [, url] of sheet.matchAll(/url\((https:[^)]+)\)/g)) sheet = sheet.replace(url, await dataUri(url));
    css.push(sheet);
  }
  return css.join("\n").replace(/\/\*.*?\*\//g, "").replace(/\s+/g, " ");
}

// ---------- render ----------

const used = [];
const esc = (s) => {
  s = String(s);
  used.push(s);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};
const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : n.toLocaleString("en-US"));
const SANS = `'Space Grotesk',system-ui,sans-serif`;
const MONO = `'JetBrains Mono',ui-monospace,monospace`;

function render(d, avatar, L) {
  const { W, PAD, pillY } = L;
  const now = new Date();
  const out = [];
  const add = (s) => out.push(s);

  // Header pill
  add(`<g class="fade">
    <rect x="${PAD}" y="${pillY}" width="160" height="48" rx="24" fill="${C.panel}" stroke="${C.line}"/>
    <clipPath id="av"><circle cx="${PAD + 24}" cy="${pillY + 24}" r="16"/></clipPath>
    <filter id="mono"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="1.05" intercept="-0.025"/><feFuncG type="linear" slope="1.05" intercept="-0.025"/><feFuncB type="linear" slope="1.05" intercept="-0.025"/></feComponentTransfer></filter>
    <circle cx="${PAD + 24}" cy="${pillY + 24}" r="16" fill="#0f0f12"/>
    ${avatar ? `<g clip-path="url(#av)"><image href="${avatar}" x="${PAD + 8}" y="${pillY + 8}" width="32" height="32" preserveAspectRatio="xMidYMid slice" filter="url(#mono)"/></g>` : ""}
    <text x="${PAD + 50}" y="${pillY + 29}" font-family="${SANS}" font-size="14" font-weight="500" fill="${C.text}">${esc(PROFILE.name)}</text>
  </g>`);
  add(`<text x="${W - PAD}" y="${pillY + 29}" text-anchor="end" font-family="${MONO}" font-size="12" fill="${C.muted}">${esc(PROFILE.site)} <tspan fill="rgb(${C.accent})">${esc("↗")}</tspan></text>`);

  // Headline
  add(`<text class="fade d1" font-family="${SANS}" font-size="${L.head.size}" letter-spacing="${-L.head.size / 38}" fill="${C.text}">
    <tspan x="${PAD}" y="${L.head.y[0]}">${esc(PROFILE.headline[0])}</tspan>
    <tspan x="${PAD}" y="${L.head.y[1]}">${esc(PROFILE.headline[1])}<tspan class="blink" fill="rgb(${C.accent})">${esc("_")}</tspan></tspan>
  </text>`);

  // Tagline
  const lines = PROFILE.tagline.map((parts, i) =>
    `<tspan x="${PAD}" y="${L.tag.y + i * L.tag.step}">` +
    parts.map(([s, strong]) => `<tspan${strong ? ` fill="${C.text}" font-weight="500"` : ""}>${esc(s)}</tspan>`).join("") +
    `</tspan>`);
  add(`<text class="fade d2" font-family="${MONO}" font-size="${L.tag.size}" fill="${C.muted}" xml:space="preserve">${lines.join("")}</text>`);

  // Venues
  add(`<g class="fade d3" font-family="${MONO}">
    <text x="${PAD}" y="${L.venuesY}" font-size="9.5" fill="${C.muted}">${esc("PUBLISHED & PRESENTED AT")}</text>
    <text x="${PAD + 152}" y="${L.venuesY}" font-size="11" font-weight="500" fill="${C.text}">${esc(PROFILE.venues.join("  ·  "))}</text>
  </g>`);

  // Stats panel
  const { x: px, y: py, w: pw, h: ph } = L.panel;
  add(`<g class="fade d2">
    <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="14" fill="${C.panel}" fill-opacity="0.82" stroke="${C.line}"/>`);
  const stats = [
    ["CONTRIBUTIONS", fmt(d.contributions)],
    ["STARS EARNED", fmt(d.stars)],
    ["REPOSITORIES", fmt(d.repos)],
    ["FOLLOWERS", fmt(d.followers)],
  ];
  stats.forEach(([label, value], i) => {
    const x = px + 24 + (i % 2) * (pw / 2), y = py + 36 + Math.floor(i / 2) * 74;
    add(`<text x="${x}" y="${y}" font-family="${MONO}" font-size="9.5" fill="${C.muted}">${esc(label)}</text>
    <text x="${x}" y="${y + 36}" font-family="${SANS}" font-size="32" letter-spacing="-0.8" fill="${C.text}">${esc(value)}</text>`);
  });
  add(`</g>`);

  // Contribution heatmap
  const weeks = d.weeks.slice(-L.heat.weeks);
  const hy = L.heat.y, step = (W - 2 * PAD + 4) / L.heat.weeks, cell = step - 4;
  add(`<g font-family="${MONO}" font-size="9.5" fill="${C.muted}">
    <text x="${PAD}" y="${hy - 16}">${esc("ACTIVITY · " + L.heat.label)}</text>
    <text x="${W - PAD}" y="${hy - 16}" text-anchor="end">${esc("UPDATED " + now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase())}</text>
  </g>`);
  const opac = [0.05, 0.22, 0.42, 0.66, 0.94];
  const lastDate = weeks.at(-1)?.at(-1)?.date;
  weeks.forEach((week, wi) => {
    week.forEach((day) => {
      const di = new Date(day.date + "T00:00:00Z").getUTCDay();
      const isToday = day.date === lastDate;
      const x = PAD + wi * step, y = hy + di * step;
      add(`<rect class="cell" style="animation-delay:${(wi * 18).toFixed(0)}ms" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" rx="2.5" fill="${isToday ? `rgb(${C.accent})` : `rgba(${C.dot},${opac[day.level]})`}"/>`);
    });
  });

  return out.join("\n");
}

const data = await (TOKEN ? fromGraphQL() : fromPublic());
const avatar = await siteAvatar()
  .catch((e) => (console.warn("site avatar:", e.message), dataUri(data.avatarUrl)))
  .catch(() => "");
const bodies = Object.fromEntries(Object.entries(LAYOUTS).map(([k, L]) => [k, render(data, avatar, L)]));
const fonts = await embedFonts(used.join("") + "0123456789,.k").catch((e) => (console.warn("fonts:", e.message), ""));

const doc = ({ W, H }, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${PROFILE.name}: ${PROFILE.headline.join(" ")}">
<title>${PROFILE.name} · ${PROFILE.site}</title>
<style>${fonts}
.fade{animation:fade .8s ease-out both}.d1{animation-delay:.1s}.d2{animation-delay:.25s}.d3{animation-delay:.4s}
.cell{animation:fade .5s ease-out both}
.blink{animation:blink 1.1s steps(1) infinite}
@keyframes fade{from{opacity:0}}
@keyframes blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<defs>
  <pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="rgba(${C.dot},0.11)"/></pattern>
  <radialGradient id="fadeMask" cx="0.78" cy="0.12" r="0.85"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <mask id="m"><rect width="${W}" height="${H}" fill="url(#fadeMask)"/></mask>
  <radialGradient id="glow" cx="0.82" cy="0.05" r="0.55"><stop offset="0" stop-color="rgb(${C.accent})" stop-opacity="0.13"/><stop offset="1" stop-color="rgb(${C.accent})" stop-opacity="0"/></radialGradient>
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath>
</defs>
<g clip-path="url(#frame)">
<rect width="${W}" height="${H}" fill="${C.bg}"/>
<rect width="${W}" height="${H}" fill="url(#dots)" mask="url(#m)"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
${body}
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="17.5" fill="none" stroke="${C.line}"/>
</svg>
`;

for (const [k, L] of Object.entries(LAYOUTS)) {
  const file = k === "desktop" ? OUT : OUT.replace(/.svg$/, `-${k}.svg`);
  const svg = doc(L, bodies[k]);
  await writeFile(file, svg);
  console.log(`wrote ${file} (${(svg.length / 1024).toFixed(1)} KB) via ${TOKEN ? "GraphQL" : "public API"}`);
}
