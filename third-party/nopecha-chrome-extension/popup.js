let plan = null,
  checking_server_plan = !1,
  rendering_server_plan = !1;
function sleep(t) {
  return new Promise((e) => setTimeout(t));
}
function get_loading_html() {
  return '<div class="loading"><div></div><div></div><div></div><div></div></div>';
}
function number_with_comma(e) {
  return (e = e || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
async function check_plan() {
  var e = await BG.exec("Settings.get");
  e &&
    !checking_server_plan &&
    ((checking_server_plan = !0),
    ((plan = (plan = await BG.exec("Server.get_plan", { key: e.key })).error
      ? {
          error: !0,
          plan: plan.message,
          credit: 0,
          quota: 0,
          duration: null,
          lastreset: null,
          current_period_start: 1,
          current_period_end: 1,
        }
      : plan).subscription = [
      "Starter",
      "Basic",
      "Professional",
      "Enterprise",
    ].includes(plan.plan)),
    (plan.expired = !1),
    plan.subscription
      ? ((e = Date.now() / 1e3),
        plan.current_period_end - e < 0 &&
          ((plan.expired = !0), (plan.credit = 0), (plan.quota = 0)))
      : ["GitHub", "Discord", "Booster"].includes(plan.plan) &&
        ((e = Date.now() / 1e3),
        0 === Math.max(0, plan.lastreset - plan.duration - e)) &&
        ((plan.expired = !0), (plan.credit = 0), (plan.quota = 0)),
    (plan.invalid = !1),
    ["Banned IP", "Invalid key", "Rate limit reached"].includes(plan.plan)
      ? (plan.invalid = !0)
      : (plan.plan = plan.plan + " Plan"),
    (checking_server_plan = !1),
    document.querySelector("#loading_overlay").classList.add("hidden"));
}
async function render_plan() {
  var t = await BG.exec("Settings.get");
  if (t && plan && !rendering_server_plan) {
    rendering_server_plan = !0;
    var t = document.querySelector("#plan"),
      n = document.querySelector("#credit"),
      a = document.querySelector("#refills"),
      s = document.querySelector("#ipbanned_warning"),
      d = Date.now() / 1e3;
    let e = null;
    plan.lastreset &&
      plan.duration &&
      (e = Math.floor(Math.max(0, plan.duration - (d - plan.lastreset)))),
      (t.innerHTML = plan.plan),
      plan.invalid || plan.error
        ? t.classList.add("red")
        : t.classList.remove("red"),
      "Banned IP" === plan.plan
        ? s.classList.remove("hidden")
        : s.classList.add("hidden"),
      (n.innerHTML =
        number_with_comma(plan.credit) + " / " + number_with_comma(plan.quota)),
      0 === plan.credit ? n.classList.add("red") : n.classList.remove("red"),
      plan.expired
        ? ((a.innerHTML = "Expired"), a.classList.add("red"))
        : (plan.duration < 0
            ? ((a.innerHTML = "No refills"), a.classList.add("red"))
            : (e
                ? ((d = Time.seconds_as_hms(e)), (a.innerHTML = "" + d))
                : (a.innerHTML = get_loading_html()),
              a.classList.remove("red")),
          1 === plan.lastreset
            ? ((a.innerHTML = "Not activated"), a.classList.add("red"))
            : 0 < plan.duration &&
              0 === e &&
              (await sleep(1e3), await check_plan())),
      (rendering_server_plan = !1);
  }
}
async function init_ui() {
  const i = await BG.exec("Settings.get");
  var e = document.querySelector("#power");
  const t = e.querySelector(".spinning"),
    n = e.querySelector(".static"),
    a = e.querySelector(".btn");
  i.enabled
    ? (n.classList.remove("hidden"), a.classList.remove("off"))
    : a.classList.add("off");
  let s = null;
  e.addEventListener("click", async () => {
    clearTimeout(s),
      t.classList.add("hidden"),
      n.classList.add("hidden"),
      a.classList.contains("off")
        ? (a.classList.remove("off"),
          t.classList.remove("hidden"),
          await BG.exec("Settings.set", { id: "enabled", value: !0 }),
          await BG.exec("Icon.set", { status: "on" }),
          (s = setTimeout(() => {
            t.classList.add("hidden"), n.classList.remove("hidden");
          }, 1e3)))
        : (await BG.exec("Settings.set", { id: "enabled", value: !1 }),
          await BG.exec("Icon.set", { status: "off" }),
          a.classList.add("off"));
  });
  const d = document.querySelector('.settings_text[data-settings="key"]'),
    r = document.querySelector(".edit_icon"),
    l = document.querySelector(".key_label");
  function c() {
    d.classList.contains("hiddenleft")
      ? (d.classList.remove("hiddenleft"),
        d.focus(),
        r.classList.remove("hidden"),
        l.classList.add("hidden"))
      : (d.classList.add("hiddenleft"),
        r.classList.add("hidden"),
        l.classList.remove("hidden"));
  }
  document.querySelector("#edit_key").addEventListener("click", () => {
    c(), check_plan();
  }),
    d.addEventListener("keydown", (e) => {
      "Enter" === (e = e || window.event).key &&
        (c(),
        check_plan(),
        0 < d.value.length
          ? document.querySelector("#export").classList.remove("hidden")
          : document.querySelector("#export").classList.add("hidden"));
    }),
    0 < i.key?.length
      ? document.querySelector("#export").classList.remove("hidden")
      : document.querySelector("#export").classList.add("hidden");
  for (const y of document.querySelectorAll(
    '[data-tabtarget]:not([data-tabtarget=""])'
  ))
    y.addEventListener("click", () => {
      for (const e of document.querySelectorAll(".tab"))
        e.classList.add("hidden");
      document
        .querySelector(`[data-tab="${y.dataset.tabtarget}"]`)
        .classList.remove("hidden");
    });
  function o() {
    document.querySelector(".tab:not(.hidden)").querySelector(".back")?.click();
  }
  document.addEventListener("mousedown", (e) => {
    0 < (8 & (e = e || window.event).buttons) && o();
  }),
    document.addEventListener("keydown", (e) => {
      "Backspace" !== (e = e || window.event).key ||
        e.target instanceof HTMLInputElement ||
        o();
    });
  for (const [f, h] of Object.entries(i)) {
    for (const g of document.querySelectorAll(
      `.settings_toggle[data-settings="${f}"]`
    ))
      g.classList.remove("on", "off"),
        g.classList.add(h ? "on" : "off"),
        g.addEventListener("click", async () => {
          var e = g.classList.contains("off");
          await BG.exec("Settings.set", { id: f, value: e }),
            g.classList.remove("on", "off"),
            g.classList.add(e ? "on" : "off");
        });
    for (const S of document.querySelectorAll(
      `.settings_dropdown[data-settings="${f}"]`
    ))
      S.dataset.value === h &&
        (S.classList.add("selected"),
        (document.querySelector(S.dataset.displays).innerHTML = S.innerHTML)),
        S.addEventListener("click", async () => {
          document
            .querySelector(`.settings_dropdown.selected[data-settings="${f}"]`)
            ?.classList?.remove("selected");
          var e = S.dataset.value;
          await BG.exec("Settings.set", { id: f, value: e }),
            S.classList.add("selected"),
            (document.querySelector(S.dataset.displays).innerHTML =
              S.innerHTML);
        });
    for (const w of document.querySelectorAll(
      `.settings_text[data-settings="${f}"]`
    ))
      (w.value = h),
        w.addEventListener("input", async () => {
          var e = w.value;
          await BG.exec("Settings.set", { id: f, value: e });
        });
  }
  for (const q of document.querySelectorAll(".locate"))
    q.addEventListener("click", async () => {
      var e = q.dataset.key;
      await BG.exec("Relay.send", {
        data: { action: "start_locate", locate: e },
      }),
        window.close();
    });
  const u = document.querySelector("#disabled_hosts");
  async function p(e = !0) {
    var t = new Set();
    for (const n of i.disabled_hosts) t.add(n.trim());
    (i.disabled_hosts = [...t]),
      await BG.exec("Settings.set", {
        id: "disabled_hosts",
        value: i.disabled_hosts,
      }),
      e && (await v());
  }
  async function v() {
    u.innerHTML = "";
    var e = document.querySelector("#template > #disabled_hosts_item");
    let t = null;
    for (const a in i.disabled_hosts) {
      var n = i.disabled_hosts[a]?.trim();
      if (n) {
        const s = e.cloneNode(!0),
          d = ((s.id = null), s.querySelector("input.hostname"));
        (d.value = n),
          d.addEventListener("input", () => {
            clearTimeout(t),
              (i.disabled_hosts[a] = d.value),
              (t = setTimeout(async () => {
                await p(!1);
              }, 200));
          }),
          s.querySelector(".remove").addEventListener("click", () => {
            var e = i.disabled_hosts.indexOf(d.value);
            -1 !== e && (i.disabled_hosts.splice(e, 1), p(!1)), s.remove();
          }),
          u.append(s);
      }
    }
  }
  !(async function () {
    var e = await BG.exec("Tab.active");
    const t = (e.url || "Unknown Host").replace(
      /^(.*:)\/\/([A-Za-z0-9\-\.]+)(:[0-9]+)?(.*)$/,
      "$2"
    );
    document.querySelector("#current_page_host").innerHTML = t;
    let n = !0;
    (e.url && !i.disabled_hosts.includes(i.disabled_hosts)) || (n = !1),
      (e = document.querySelector("#add_current_page_host")),
      n
        ? e.addEventListener("click", async () => {
            i.disabled_hosts.push(t), await p();
          })
        : (e.disabled = !0);
  })(),
    v(),
    document.querySelector("#export").addEventListener("click", async () => {
      var e = await BG.exec("Settings.get"),
        e = SettingsManager.export(e);
      window.open(e, "_blank");
    });
  var m = "Version " + chrome.runtime.getManifest().version;
  for (const b of document.querySelectorAll(".footer")) {
    var _ = document.createElement("div"),
      L = ((_.innerHTML = m), document.createElement("div"));
    (L.innerHTML = "2022 NopeCHA"), b.append(_), b.append(L);
  }
}
async function main() {
  await init_ui(),
    await check_plan(),
    await render_plan(),
    setInterval(render_plan, 500);
}
document.addEventListener("DOMContentLoaded", main);
