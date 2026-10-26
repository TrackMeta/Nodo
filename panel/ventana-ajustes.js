// Estilos de las ventanas flotantes de ajustes (Ajustes de pagos, y las de Pedidos → ⋯). Archivo aparte (25-oct):
// si una página importa un módulo y el navegador tiene guardada una versión vieja sin ese export, la página entera
// queda en blanco; con un archivo propio y nuevo eso no puede pasar.
const CSS = `
.ajp-ov{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:18px}
.ajp{background:var(--surface);border:1px solid var(--border);border-radius:18px;width:100%;max-width:640px;max-height:90vh;overflow:auto;padding:20px 22px;color:var(--text);font-family:var(--font)}
.ajp-hd{display:flex;align-items:center;gap:10px}
.ajp-hd h3{flex:1;margin:0;font-size:18px;display:flex;align-items:center;gap:8px}
.ajp-hd h3 svg{width:18px;height:18px;color:var(--brand)}
.ajp-x{height:34px;width:34px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);display:inline-flex;align-items:center;justify-content:center}
.ajp-x svg{width:15px;height:15px}
.ajp-sub{color:var(--muted);font-size:12.5px;line-height:1.55;margin:6px 0 4px}
.ajp-card{border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-top:14px}
.ajp-card h4{margin:0;font-size:14.5px;display:flex;align-items:center;gap:8px}
.ajp-card h4 svg{width:17px;height:17px;color:var(--brand)}
.ajp-desc{color:var(--muted);font-size:12.5px;margin:6px 0 4px;line-height:1.55}
.ajp-lbl{display:block;font-size:12.5px;font-weight:700;margin:12px 0 6px}
.ajp-opt{border:1.5px solid var(--border);border-radius:12px;padding:12px 13px;display:flex;gap:12px;align-items:flex-start;cursor:pointer;margin-top:8px}
.ajp-opt.on{border-color:var(--brand);background:rgba(43,127,255,.10)}
.ajp-dot{width:18px;height:18px;border-radius:50%;border:2px solid var(--border);flex:none;margin-top:2px;display:flex;align-items:center;justify-content:center}
.ajp-opt.on .ajp-dot{border-color:var(--brand)} .ajp-dot i{width:9px;height:9px;border-radius:50%;background:var(--brand);display:none}
.ajp-opt.on .ajp-dot i{display:block}
.ajp-opt b{display:block;font-size:13.5px} .ajp-opt > div > span{display:block;font-size:12px;color:var(--muted);margin-top:3px;line-height:1.5}
.ajp-num{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;font-size:12.5px}
.ajp-num .box{display:flex;align-items:center;border:1px solid var(--border);border-radius:8px;overflow:hidden}
.ajp-num .box span{color:var(--muted);font-weight:700;padding:0 4px 0 10px}
.ajp-num input{width:76px;height:34px;border:none;background:var(--surface-2);color:var(--text);padding:0 8px;font-family:var(--font)}
.ajp-num small{flex:1;min-width:200px;color:var(--faint);font-size:11.5px;line-height:1.5}
.ajp textarea{width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;color:var(--text);padding:10px 12px;font-size:13.5px;line-height:1.5;font-family:var(--font);resize:vertical;outline:none}
.ajp textarea:focus{border-color:var(--brand)}
.ajp-hint{font-size:11px;color:var(--faint);margin-top:6px;line-height:1.5}
.ajp-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.ajp-btn{height:38px;padding:0 16px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:13px;font-weight:600}
.ajp-btn.pri{background:var(--brand);border-color:var(--brand);color:#fff}
.ajp-btn:disabled{opacity:.5}
.ajp-sw{width:44px;height:25px;border-radius:20px;background:var(--surface-2);border:1px solid var(--border);position:relative;transition:.15s;flex:none;cursor:pointer}
.ajp-sw::after{content:"";position:absolute;top:2px;left:2px;width:19px;height:19px;border-radius:50%;background:var(--muted);transition:.15s}
.ajp-sw.on{background:var(--brand);border-color:var(--brand)} .ajp-sw.on::after{left:20px;background:#fff}
.ajp-tog{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;border:1px solid var(--border);border-radius:11px;padding:11px 12px;cursor:pointer}
.ajp-tog b{font-size:13px} .ajp-tog small{display:block;font-size:11.5px;color:var(--faint);margin-top:2px;font-weight:400}
.ajp-in{height:36px;background:var(--surface-2);border:1px solid var(--border);border-radius:9px;color:var(--text);padding:0 10px;font-size:13px;font-family:var(--font)}
.ajp-mom{border:1px solid var(--border);border-radius:12px;padding:12px 13px;margin-top:12px}
.ajp-mom > b{display:block;font-size:13.5px} .ajp-mom > small{display:block;font-size:11.5px;color:var(--faint);margin:2px 0 8px}
.ajp-fila{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:12px}
.ajp-fila > span{color:var(--muted);font-weight:700;min-width:150px}
.ajp-nota{display:flex;gap:9px;border:1px solid var(--border);border-radius:11px;padding:10px 12px;margin-top:12px;font-size:12px;color:var(--muted);line-height:1.5;background:rgba(43,127,255,.08)}
`;
let _css = false;
export function asegurarEstilos() { if (!_css) { const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); _css = true; } }
