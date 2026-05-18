// Renders a small SVG triangle showing where the account sits between the
// three experimental archetypes: Bot, Stan, Farmer. Center = normal user.
//
// Input: { bot, stan, farmer } — numbers in [0, 1]; normalized internally.
// Output: a DOM element to append into the table cell, or null if no data.

const BON_TRIANGLE_VIEW = {
  W: 84,
  H: 76,
  // Triangle vertices (top = Bot, bottom-left = Stan, bottom-right = Farmer).
  topX: 42,
  topY: 14,
  blX: 12,
  blY: 64,
  brX: 72,
  brY: 64,
};

// Hoist gradient + filter defs into a single hidden SVG on the page so every
// widget instance can reference the same IDs. Avoids ~N copies of the defs
// when rendering rows in the reports table.
function bonEnsureTriangleDefs() {
  if (document.getElementById("bon-triangle-defs")) return;
  const svgns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgns, "svg");
  svg.id = "bon-triangle-defs";
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  svg.style.pointerEvents = "none";

  const v = BON_TRIANGLE_VIEW;
  // Radius reaches roughly to the opposite edge of the triangle.
  const R = 58;

  const corners = [
    { id: "bon-tri-g-bot", cx: v.topX, cy: v.topY, color: "#ef4444" },
    { id: "bon-tri-g-stan", cx: v.blX, cy: v.blY, color: "#ec4899" },
    { id: "bon-tri-g-farmer", cx: v.brX, cy: v.brY, color: "#8b5cf6" },
  ];

  const defs = document.createElementNS(svgns, "defs");
  for (const c of corners) {
    const grad = document.createElementNS(svgns, "radialGradient");
    grad.id = c.id;
    grad.setAttribute("cx", c.cx);
    grad.setAttribute("cy", c.cy);
    grad.setAttribute("r", R);
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    const s1 = document.createElementNS(svgns, "stop");
    s1.setAttribute("offset", "0");
    s1.setAttribute("stop-color", c.color);
    s1.setAttribute("stop-opacity", "0.72");
    const s2 = document.createElementNS(svgns, "stop");
    s2.setAttribute("offset", "1");
    s2.setAttribute("stop-color", c.color);
    s2.setAttribute("stop-opacity", "0");
    grad.appendChild(s1);
    grad.appendChild(s2);
    defs.appendChild(grad);
  }

  const triShadow = document.createElementNS(svgns, "filter");
  triShadow.id = "bon-tri-shadow";
  triShadow.setAttribute("x", "-20%");
  triShadow.setAttribute("y", "-20%");
  triShadow.setAttribute("width", "140%");
  triShadow.setAttribute("height", "140%");
  const ds1 = document.createElementNS(svgns, "feDropShadow");
  ds1.setAttribute("dx", "0");
  ds1.setAttribute("dy", "1");
  ds1.setAttribute("stdDeviation", "1.4");
  ds1.setAttribute("flood-opacity", "0.18");
  triShadow.appendChild(ds1);
  defs.appendChild(triShadow);

  const dotShadow = document.createElementNS(svgns, "filter");
  dotShadow.id = "bon-tri-dot-shadow";
  dotShadow.setAttribute("x", "-50%");
  dotShadow.setAttribute("y", "-50%");
  dotShadow.setAttribute("width", "200%");
  dotShadow.setAttribute("height", "200%");
  const ds2 = document.createElementNS(svgns, "feDropShadow");
  ds2.setAttribute("dx", "0");
  ds2.setAttribute("dy", "0.6");
  ds2.setAttribute("stdDeviation", "0.7");
  ds2.setAttribute("flood-opacity", "0.4");
  dotShadow.appendChild(ds2);
  defs.appendChild(dotShadow);

  svg.appendChild(defs);
  (document.body || document.documentElement).appendChild(svg);
}

function bonRenderTriangleWidget(triangleData) {
  if (!triangleData) return null;
  const { bot = 0, stan = 0, farmer = 0 } = triangleData;
  const total = bot + stan + farmer;
  if (total <= 0) return null;

  bonEnsureTriangleDefs();

  const b = bot / total;
  const s = stan / total;
  const f = farmer / total;

  const v = BON_TRIANGLE_VIEW;
  const tri = `${v.topX},${v.topY} ${v.blX},${v.blY} ${v.brX},${v.brY}`;
  const dotX = b * v.topX + s * v.blX + f * v.brX;
  const dotY = b * v.topY + s * v.blY + f * v.brY;

  const svgns = "http://www.w3.org/2000/svg";

  const wrap = document.createElement("span");
  wrap.className = "bon-triangle";

  const svg = document.createElementNS(svgns, "svg");
  svg.setAttribute("viewBox", `0 0 ${v.W} ${v.H}`);
  svg.setAttribute("width", v.W);
  svg.setAttribute("height", v.H);
  svg.classList.add("bon-triangle-svg");

  // Group with drop shadow contains the base shape + colored washes only.
  // The dot and labels sit outside the group so the shadow doesn't muddy them.
  const shadowGroup = document.createElementNS(svgns, "g");
  shadowGroup.setAttribute("filter", "url(#bon-tri-shadow)");

  const base = document.createElementNS(svgns, "polygon");
  base.setAttribute("points", tri);
  base.classList.add("bon-triangle-base");
  shadowGroup.appendChild(base);

  for (const id of ["bon-tri-g-bot", "bon-tri-g-stan", "bon-tri-g-farmer"]) {
    const wash = document.createElementNS(svgns, "polygon");
    wash.setAttribute("points", tri);
    wash.setAttribute("fill", `url(#${id})`);
    shadowGroup.appendChild(wash);
  }

  // Outline drawn last (inside the shadow group) so it sits cleanly on top.
  const outline = document.createElementNS(svgns, "polygon");
  outline.setAttribute("points", tri);
  outline.classList.add("bon-triangle-outline");
  shadowGroup.appendChild(outline);

  svg.appendChild(shadowGroup);

  // Corner letters positioned just outside each vertex.
  const labels = [
    { x: v.topX, y: v.topY - 6, text: "B" },
    { x: v.blX - 6, y: v.blY + 8, text: "S" },
    { x: v.brX + 6, y: v.blY + 8, text: "F" },
  ];
  for (const l of labels) {
    const t = document.createElementNS(svgns, "text");
    t.setAttribute("x", l.x);
    t.setAttribute("y", l.y);
    t.classList.add("bon-triangle-label");
    t.textContent = l.text;
    svg.appendChild(t);
  }

  // Halo behind the dot to lift it off the colored wash.
  const halo = document.createElementNS(svgns, "circle");
  halo.setAttribute("cx", dotX);
  halo.setAttribute("cy", dotY);
  halo.setAttribute("r", 4);
  halo.classList.add("bon-triangle-halo");
  svg.appendChild(halo);

  const dot = document.createElementNS(svgns, "circle");
  dot.setAttribute("cx", dotX);
  dot.setAttribute("cy", dotY);
  dot.setAttribute("r", 2.6);
  dot.setAttribute("filter", "url(#bon-tri-dot-shadow)");
  dot.classList.add("bon-triangle-dot");
  svg.appendChild(dot);

  wrap.appendChild(svg);

  const pct = (n) => Math.round(n * 100);
  wrap.title = `Bot ${pct(b)}%  ·  Stan ${pct(s)}%  ·  Farmer ${pct(f)}%`;

  return wrap;
}
