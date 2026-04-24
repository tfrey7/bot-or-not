(async function () {
  const heading = document.getElementById("bon-reports-heading");
  const list = document.getElementById("bon-reports-list");

  try {
    const { reports = {} } = await browser.runtime.sendMessage({
      type: "get-all-reports",
    });

    const entries = Object.entries(reports).sort((a, b) => b[1] - a[1]);

    heading.textContent = `Reported users (${entries.length})`;

    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "bon-empty";
      empty.textContent = "No reports yet.";
      list.replaceWith(empty);
      return;
    }

    for (const [username, count] of entries) {
      const li = document.createElement("li");

      const link = document.createElement("a");
      link.href = `https://www.reddit.com/user/${encodeURIComponent(username)}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `u/${username}`;

      const countEl = document.createElement("span");
      countEl.className = "bon-report-count";
      countEl.textContent = `(${count}x)`;

      li.appendChild(link);
      li.appendChild(countEl);
      list.appendChild(li);
    }
  } catch (err) {
    console.error("[Bot or Not] failed to load reports", err);
    heading.textContent = "Reported users";
    const errEl = document.createElement("p");
    errEl.className = "bon-empty";
    errEl.textContent = "Failed to load reports.";
    list.replaceWith(errEl);
  }
})();
