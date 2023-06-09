(async () => {
  function e() {
    var e =
        "true" ===
        document
          .querySelector(".recaptcha-checkbox")
          ?.getAttribute("aria-checked"),
      t = document.querySelector("#recaptcha-verify-button")?.disabled;
    return e || t;
  }
  function d(r = 15e3) {
    return new Promise(async (e) => {
      for (var t = Time.time(); ; ) {
        var a = document.querySelectorAll(".rc-imageselect-tile"),
          c = document.querySelectorAll(".rc-imageselect-dynamic-selected");
        if (0 < a.length && 0 === c.length) return e(!0);
        if (Time.time() - t > r) return e(!1);
        await Time.sleep(100);
      }
    });
  }
  let p = null;
  function a(e = 500) {
    return new Promise((m) => {
      let h = !1;
      const f = setInterval(async () => {
        if (!h) {
          h = !0;
          var c = document
              .querySelector(".rc-imageselect-instructions")
              ?.innerText?.split("\n"),
            r = await (async function (e) {
              let t = null;
              return (
                (t =
                  1 < e.length
                    ? (t = e.slice(0, 2).join(" ")).replace(/\s+/g, " ")?.trim()
                    : t.join("\n")) || null
              );
            })(c);
          if (r) {
            var c = 3 === c.length,
              i = document.querySelectorAll("table tr td");
            if (9 === i.length || 16 === i.length) {
              var l = [],
                n = Array(i.length).fill(null);
              let e = null,
                t = !1,
                a = 0;
              for (const u of i) {
                var o = u?.querySelector("img");
                if (!o) return void (h = !1);
                var s = o?.src?.trim();
                if (!s || "" === s) return void (h = !1);
                300 <= o.naturalWidth
                  ? (e = s)
                  : 100 == o.naturalWidth && ((n[a] = s), (t = !0)),
                  l.push(u),
                  a++;
              }
              t && (e = null);
              i = JSON.stringify([e, n]);
              if (p !== i)
                return (
                  (p = i),
                  clearInterval(f),
                  (h = !1),
                  m({
                    task: r,
                    is_hard: c,
                    cells: l,
                    background_url: e,
                    urls: n,
                  })
                );
            }
          }
          h = !1;
        }
      }, e);
    });
  }
  async function t() {
    !0 ===
      (await BG.exec("Cache.get", {
        name: "recaptcha_widget_visible",
        tab_specific: !0,
      })) &&
      (e()
        ? (r = r || !0)
        : ((r = !1),
          await Time.sleep(500),
          document.querySelector("#recaptcha-anchor")?.click()));
  }
  async function c() {
    var c = await BG.exec("Cache.get", {
      name: "recaptcha_image_visible",
      tab_specific: !0,
    });
    if (
      !0 === c &&
      null === document.querySelector(".rc-doscaptcha-header") &&
      !e()
    )
      if (
        ((g = !(
          g ||
          !(function () {
            for (const e of [".rc-imageselect-incorrect-response"])
              if ("" === document.querySelector(e)?.style.display) return 1;
          })() ||
          ((y = []), 0)
        )),
        (function () {
          for (const t of [
            ".rc-imageselect-error-select-more",
            ".rc-imageselect-error-dynamic-more",
            ".rc-imageselect-error-select-something",
          ]) {
            var e = document.querySelector(t);
            if ("" === e?.style.display || 0 === e?.tabIndex) return 1;
          }
        })())
      )
        y = [];
      else if (await d()) {
        var {
            task: c,
            is_hard: r,
            cells: t,
            background_url: i,
            urls: l,
          } = await a(),
          n = await BG.exec("Settings.get");
        if (n && n.enabled && n.recaptcha_auto_solve) {
          var o = 9 == t.length ? 3 : 4,
            s = [];
          let e,
            a = [];
          if (null === i) {
            e = "1x1";
            for (let e = 0; e < l.length; e++) {
              var u = l[e],
                m = t[e];
              u && !y.includes(u) && (s.push(u), a.push(m));
            }
          } else s.push(i), (e = o + "x" + o), (a = t);
          var i = Time.time(),
            h = (
              await NopeCHA.post({
                captcha_type: IS_DEVELOPMENT ? "recaptcha_dev" : "recaptcha",
                task: c,
                image_urls: s,
                grid: e,
                key: n.key,
              })
            )["data"];
          if (h) {
            (c = parseInt(n.recaptcha_solve_delay_time) || 1e3),
              (n = n.recaptcha_solve_delay ? c - (Time.time() - i) : 0);
            0 < n && (await Time.sleep(n));
            let t = 0;
            for (let e = 0; e < h.length; e++)
              !1 !== h[e] &&
                (t++,
                (function (e) {
                  try {
                    return e.classList.contains("rc-imageselect-tileselected");
                  } catch {}
                })(a[e]) ||
                  (a[e]?.click(), await Time.sleep(100 * Math.random() + 200)));
            for (const f of l) y.push(f), 9 < y.length && y.shift();
            ((3 == o && r && 0 === t && (await d())) ||
              (3 == o && !r) ||
              4 == o) &&
              (await Time.sleep(200),
              document.querySelector("#recaptcha-verify-button")?.click());
          }
        }
      }
  }
  let r = !1,
    g = !1,
    y = [];
  for (;;) {
    await Time.sleep(1e3);
    var i,
      l = await BG.exec("Settings.get");
    l &&
      l.enabled &&
      "Image" === l.recaptcha_solve_method &&
      ((i = await Location.hostname()),
      l.disabled_hosts.includes(i) ||
        (await (async function () {
          var e = [
            ...document.querySelectorAll(
              'iframe[src*="/recaptcha/api2/bframe"]'
            ),
            ...document.querySelectorAll(
              'iframe[src*="/recaptcha/enterprise/bframe"]'
            ),
          ];
          if (0 < e.length) {
            for (const t of e)
              if ("visible" === window.getComputedStyle(t).visibility)
                return BG.exec("Cache.set", {
                  name: "recaptcha_image_visible",
                  value: !0,
                  tab_specific: !0,
                });
            await BG.exec("Cache.set", {
              name: "recaptcha_image_visible",
              value: !1,
              tab_specific: !0,
            });
          }
        })(),
        await (async function () {
          var e = [
            ...document.querySelectorAll(
              'iframe[src*="/recaptcha/api2/anchor"]'
            ),
            ...document.querySelectorAll(
              'iframe[src*="/recaptcha/enterprise/anchor"]'
            ),
          ];
          if (0 < e.length) {
            for (const t of e)
              if ("visible" === window.getComputedStyle(t).visibility)
                return BG.exec("Cache.set", {
                  name: "recaptcha_widget_visible",
                  value: !0,
                  tab_specific: !0,
                });
            await BG.exec("Cache.set", {
              name: "recaptcha_widget_visible",
              value: !1,
              tab_specific: !0,
            });
          }
        })(),
        l.recaptcha_auto_open &&
        null !== document.querySelector(".recaptcha-checkbox")
          ? await t()
          : l.recaptcha_auto_solve &&
            null !== document.querySelector("#rc-imageselect") &&
            (await c())));
  }
})();
