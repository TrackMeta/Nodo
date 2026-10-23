package pe.nodo.app;

import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
import android.graphics.drawable.Animatable;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewGroup.MarginLayoutParams;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.AccelerateInterpolator;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    static final String PREFS = "nodo";

    // Barras del celular (1.0.23): abajo y el fondo de la ventana del color del tema; arriba (hora, señal, batería),
    // si la app lo pide, el mismo degradado horizontal que la cabecera (#0044FE → #01AFFE) con íconos blancos.
    // Con Android 15 la barra de arriba no se pinta (borde a borde): lo que se ve es el fondo de la ventana; por eso
    // el degradado va como una franja arriba de ese fondo, del alto de la barra.
    static void pintarBarras(android.app.Activity a, int c, boolean claro, int[] arriba) {
        android.view.Window w = a.getWindow();
        View decor = w.getDecorView();
        androidx.core.view.WindowInsetsControllerCompat ic = androidx.core.view.WindowCompat.getInsetsController(w, decor);
        if (arriba != null && arriba.length >= 2) {
            int alto = 0;
            WindowInsetsCompat ins = ViewCompat.getRootWindowInsets(decor);
            if (ins != null) alto = ins.getInsets(WindowInsetsCompat.Type.statusBars()).top;
            if (alto <= 0) {
                int id = a.getResources().getIdentifier("status_bar_height", "dimen", "android");
                alto = id > 0 ? a.getResources().getDimensionPixelSize(id) : (int) (24 * a.getResources().getDisplayMetrics().density);
            }
            android.graphics.drawable.GradientDrawable grad = new android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT, arriba);
            android.graphics.drawable.LayerDrawable capas = new android.graphics.drawable.LayerDrawable(
                new Drawable[] { new android.graphics.drawable.ColorDrawable(c), grad });
            capas.setLayerGravity(1, Gravity.TOP | Gravity.FILL_HORIZONTAL);
            capas.setLayerHeight(1, alto);
            decor.setBackground(capas);
            w.setStatusBarColor(android.graphics.Color.TRANSPARENT);
            ic.setAppearanceLightStatusBars(false);
        } else {
            decor.setBackgroundColor(c);
            w.setStatusBarColor(c);
            ic.setAppearanceLightStatusBars(claro);
        }
        w.setNavigationBarColor(c);
        ic.setAppearanceLightNavigationBars(claro);
    }
    static int[] arribaGuardado(android.content.SharedPreferences sp) {
        if (!sp.contains("arriba1")) return null;
        return new int[] { sp.getInt("arriba1", 0xFF0044FE), sp.getInt("arriba2", 0xFF01AFFE) };
    }
    // ── Pantalla de inicio NATIVA (APK 1.0.16, 20-oct, como Vendia) ──────────────────────────────────────────────
    // La pantalla del sistema es solo el fondo; la animación entera vive en una capa nativa encima de la app:
    //   1) la «Red de nodos» (drawable/splash_n, animated-vector),
    //   2) si la app todavía no está, el logo late suave,
    //   3) la página se muestra DEBAJO con el logo quieto, y cuando ya se dibujó, el logo crece y la capa se desvanece.
    // 1.0.18 (21-oct, medido con el diagnóstico en el Xiaomi de Rodrigo): la página y la animación comparten el hilo de
    // render de Android, y el PRIMER dibujo de la página (toda la app con sus listas) lo ocupaba 200–630 ms justo cuando
    // la N se terminaba de armar → la traba. Ahora la página queda INVISIBLE mientras se arma el logo (invisible = no se
    // dibuja), se hace visible recién con el logo completo y quieto (ese dibujo pesado ya no se nota), y la salida
    // arranca cuando WebView avisa que ya tiene la app en pantalla (postVisualStateCallback) + 2 cuadros.
    // La página sabe que no debe animar nada por la marca «NodoInicioNativo/1» del user agent (capacitor.config.json) y
    // pinta lo de internet cuando Android le avisa que la capa se fue (evento «nodoInicioFin»).
    static final long N_COMPLETA = 1450;   // la «Red de nodos» + el cuadro + la N blanca, desde su primer cuadro
    static final long TOPE = 10000;        // nunca se queda pegada
    static volatile long t0 = 0;
    private final Handler h = new Handler(Looper.getMainLooper());
    private final Handler hDiag = new Handler(Looper.getMainLooper());   // (aparte: la salida vacía h)
    private FrameLayout inicio;
    private ImageView inicioLogo;
    private WebView web;
    private ObjectAnimator latido;
    private boolean appLista = false, logoCompleto = false, mostrandoWeb = false, cerrando = false;

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void mostrarInicio(int fondo) {
        inicio = new FrameLayout(this);
        inicio.setBackgroundColor(fondo);
        inicio.setClickable(true);   // nada se toca por debajo mientras carga
        inicioLogo = new ImageView(this);
        Drawable n = ContextCompat.getDrawable(this, R.drawable.splash_n);
        inicioLogo.setImageDrawable(n);
        // 288 dp: el tamaño del ícono de la pantalla de inicio de Android para el que se dibujó (logo de ~104 dp)
        inicio.addView(inicioLogo, new FrameLayout.LayoutParams(dp(288), dp(288), Gravity.CENTER));
        ((ViewGroup) getWindow().getDecorView()).addView(inicio,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // La página no se dibuja mientras se arma el logo (ver arriba)
        if (web != null) web.setVisibility(View.INVISIBLE);
        DiagInicio.marca("capa de carga puesta (página oculta)");
        // La N arranca en el PRIMER cuadro de la capa (no al llamar start()): desde ahí se cuenta cuándo termina
        final android.view.ViewTreeObserver.OnDrawListener[] od = new android.view.ViewTreeObserver.OnDrawListener[1];
        od[0] = () -> {
            if (od[0] == null) return;
            final android.view.ViewTreeObserver.OnDrawListener este = od[0];
            od[0] = null;
            DiagInicio.marca("primer cuadro de la capa dibujado");
            h.postDelayed(this::alCompletarLogo, N_COMPLETA);
            hDiag.post(() -> { try { getWindow().getDecorView().getViewTreeObserver().removeOnDrawListener(este); } catch (Throwable t) { } });
        };
        getWindow().getDecorView().getViewTreeObserver().addOnDrawListener(od[0]);
        if (n instanceof Animatable) ((Animatable) n).start();
        DiagInicio.fase("logo armándose (Red de nodos)");
        h.postDelayed(() -> salir(true), TOPE);
    }

    private void alCompletarLogo() {
        if (cerrando || inicioLogo == null) return;
        logoCompleto = true;
        if (appLista) mostrarWeb(); else latir();
    }

    // 2) La app todavía no está: (1.0.24, a pedido de Rodrigo) el logo se queda QUIETO esperándola; antes latía suave
    //    (como la V de Vendia). `latido` queda null y lo de abajo que lo cancela no hace nada.
    private void latir() {
        if (cerrando || inicioLogo == null || mostrandoWeb) return;
        DiagInicio.fase("logo quieto (esperando la app)");
    }

    // La página avisa que la app ya está armada (NodoNativo.bootListo)
    void appLista() {
        runOnUiThread(() -> {
            DiagInicio.marca("la página avisó: app lista");
            appLista = true;
            if (logoCompleto) mostrarWeb();   // si la N todavía se arma, alCompletarLogo sigue desde ahí
        });
    }

    // 3a) Logo quieto (si latía, vuelve suave a su tamaño) → la página se hace visible debajo y se espera su dibujo
    private void mostrarWeb() {
        if (cerrando || mostrandoWeb || inicio == null) return;
        mostrandoWeb = true;
        final Runnable seguir = () -> {
            DiagInicio.fase("página visible debajo (logo quieto)");
            if (web == null) { salir(false); return; }
            web.setVisibility(View.VISIBLE);
            // 1.0.19 (medido con la 1.0.18): postVisualStateCallback avisa ANTES del dibujo pesado (llegaba a los 50–70 ms
            // y el congelón de 0,4–1 s caía en plena salida). Ahora se miran los cuadros: el primer dibujo de la página
            // bloquea el hilo principal (un hueco largo entre cuadros); se sale cuando ya pasó + 2 cuadros normales. Si
            // en 10 cuadros no hubo hueco, fue liviano y se sale igual. Tope 2,5 s.
            try {
                web.postVisualStateCallback(1, new WebView.VisualStateCallback() {
                    @Override public void onComplete(long id) { DiagInicio.marca("WebView: contenido listo para dibujar"); }
                });
            } catch (Throwable t) { /* solo es una marca */ }
            final long[] previo = { 0 };
            final int[] cuadros = { 0 }, normalesTrasHueco = { 0 };
            final boolean[] hueco = { false }, hecho = { false };
            final Runnable listo = () -> { if (hecho[0]) return; hecho[0] = true; salir(false); };
            // 1.0.21 (medido con la 1.0.20): con el logo quieto el primer dibujo de la página es LIVIANO (~60 ms, a los
            // 0,7–0,95 s de mostrarla) y no deja hueco en el hilo principal, así que se esperaba siempre el tope. Ahora
            // ese primer cuadro de más de 40 ms (FrameMetrics, vía DiagInicio) cuenta como «ya se dibujó».
            DiagInicio.alCuadroLento = () -> {
                if (hecho[0] || hueco[0]) return;
                hueco[0] = true; normalesTrasHueco[0] = 0;
                DiagInicio.marca("primer dibujo de la página (cuadro lento, logo quieto)");
            };
            android.view.Choreographer.getInstance().postFrameCallback(new android.view.Choreographer.FrameCallback() {
                @Override public void doFrame(long ns) {
                    if (hecho[0] || cerrando) return;
                    long t = ns / 1_000_000L;
                    if (previo[0] > 0) {
                        long d = t - previo[0];
                        cuadros[0]++;
                        if (d > 80) { hueco[0] = true; normalesTrasHueco[0] = 0; DiagInicio.marca("primer dibujo de la página: " + d + " ms (logo quieto)"); }
                        else if (hueco[0] && d < 34) normalesTrasHueco[0]++;
                    }
                    previo[0] = t;
                    if (hueco[0] && normalesTrasHueco[0] >= 2) { listo.run(); return; }
                    android.view.Choreographer.getInstance().postFrameCallback(this);
                }
            });
            // 1.0.20 (medido con la 1.0.19): el dibujo pesado NO llega en los primeros cuadros tras mostrar la página sino
            // 0,3–1 s después (la página primero rasteriza y recién entonces entrega su cuadro): esperar «10 cuadros sin
            // hueco» (a 120 Hz, 0,08 s) salía antes de tiempo. Ahora se espera el hueco; si no aparece en 1,2 s (1.0.21), se sale.
            h.postDelayed(() -> { if (!hueco[0]) { DiagInicio.marca("sin primer dibujo en 1,2 s: sale igual"); listo.run(); } }, 1200);
            h.postDelayed(listo, 2800);   // respaldo final
        };
        if (latido != null && latido.isRunning()) {
            latido.cancel();
            inicioLogo.animate().scaleX(1f).scaleY(1f).setDuration(160).withEndAction(seguir).start();
        } else seguir.run();
    }

    // 3b) Crece un poco y la capa se desvanece hacia la app
    private void salir(boolean forzado) {
        if (inicio == null || cerrando) return;
        cerrando = true;
        DiagInicio.alCuadroLento = null;
        DiagInicio.fase(forzado ? "salida (por tiempo)" : "salida (crece y se desvanece)");
        h.removeCallbacksAndMessages(null);
        if (latido != null) latido.cancel();
        if (web != null && web.getVisibility() != View.VISIBLE) web.setVisibility(View.VISIBLE);
        final FrameLayout capa = inicio;
        inicioLogo.animate().scaleX(1.35f).scaleY(1.35f).setDuration(380).setInterpolator(new AccelerateInterpolator()).withLayer().start();
        capa.animate().alpha(0f).setDuration(380).withLayer().withEndAction(() -> {
            ViewGroup padre = (ViewGroup) capa.getParent();
            if (padre != null) padre.removeView(capa);
            inicio = null;
            inicioLogo = null;
            DiagInicio.fase("app a la vista");
            // la página pinta lo de internet recién ahora (ver panel/app/index.html)
            try { if (getBridge() != null) getBridge().triggerWindowJSEvent("nodoInicioFin"); } catch (Throwable t) { }
            hDiag.postDelayed(() -> DiagInicio.terminar(this), 2500);
        }).start();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        t0 = SystemClock.uptimeMillis();
        // Plugin propio: le dice a la app web si este APK trae Firebase (sin él, registrar avisos cerraría la app).
        registerPlugin(NodoNativoPlugin.class);
        super.onCreate(savedInstanceState);
        // 1.0.22: el medidor de cuadros se engancha DESPUÉS de super.onCreate. Antes (1.0.17–1.0.21) iba primero y
        // addOnFrameMetricsAvailableListener creaba la ventana con el tema de la pantalla de inicio, antes de que
        // Capacitor pusiera el de la app (NoActionBar): aparecía la barra de título de Android («Nodo» en una franja oscura).
        if (savedInstanceState == null) DiagInicio.empezar(this, t0);
        DiagInicio.marca("Capacitor y WebView creados");
        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        // El tema que elegiste (lo guarda NodoNativo.barras): fondo de la ventana, de la página, de la carga y barras de
        // tu color desde el primer instante, antes de que cargue la app.
        int fondo = ContextCompat.getColor(this, R.color.nodo_fondo);
        android.content.SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (sp.contains("fondo")) {
            try {
                int c = sp.getInt("fondo", 0xFF131A26);
                boolean claro = sp.getBoolean("claro", false);
                fondo = c;
                pintarBarras(this, c, claro, arribaGuardado(sp));
                if (wv != null) wv.setBackgroundColor(c);
            } catch (Throwable t) { /* sin tema guardado: el oscuro de siempre */ }
        }
        // Al girar el celular o si Android recrea la pantalla, no se repite
        web = wv;
        // 1.0.19: oculta, la página perdía prioridad (Android baja la del proceso de la web que no se ve) y empezaba a
        // cargar 0,4–2 s más tarde (medido). Se mantiene «importante» aunque esté oculta.
        if (wv != null && android.os.Build.VERSION.SDK_INT >= 26) {
            try { wv.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false); } catch (Throwable t) { }
        }
        // 1.0.21: que la página vaya preparando su imagen aunque no se vea (más memoria, pero su primer dibujo al
        // mostrarla llega antes)
        if (wv != null) { try { wv.getSettings().setOffscreenPreRaster(true); } catch (Throwable t) { } }
        if (savedInstanceState == null) mostrarInicio(fondo);
        // Respaldo si la página no avisa (sin internet, página de error, una versión vieja en caché)
        if (getBridge() != null) {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageStarted(WebView webView) { DiagInicio.marca("página: empezó a cargar"); }
                @Override
                public void onPageLoaded(WebView webView) { DiagInicio.marca("página: cargó (HTML + scripts)"); h.postDelayed(() -> salir(true), 6000); }
                @Override
                public void onReceivedError(WebView webView) { h.postDelayed(() -> salir(true), 1500); }
            });
        }
        // Teclado: Capacitor deja márgenes para las barras del sistema (adjustMarginsForEdgeToEdge) pero no para el
        // teclado, y con Android 15 el teclado tapaba la hoja de abajo y la caja de escribir. Mismo cálculo + el teclado:
        // abajo se deja lo que sea más alto, la barra de navegación o el teclado, y la página se achica por encima.
        if (wv != null) {
            ViewCompat.setOnApplyWindowInsetsListener(wv, (v, wi) -> {
                Insets bars = wi.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                Insets ime = wi.getInsets(WindowInsetsCompat.Type.ime());
                MarginLayoutParams mlp = (MarginLayoutParams) v.getLayoutParams();
                mlp.leftMargin = bars.left;
                mlp.rightMargin = bars.right;
                mlp.topMargin = bars.top;
                mlp.bottomMargin = Math.max(bars.bottom, ime.bottom);
                v.setLayoutParams(mlp);
                return WindowInsetsCompat.CONSUMED;
            });
        }
    }
}
