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

    // 2) La app todavía no está: late suave (como la V de Vendia)
    private void latir() {
        if (cerrando || inicioLogo == null || mostrandoWeb) return;
        DiagInicio.fase("latido (esperando la app)");
        latido = ObjectAnimator.ofPropertyValuesHolder(inicioLogo,
            PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.06f),
            PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.06f));
        latido.setDuration(560);
        latido.setRepeatCount(ValueAnimator.INFINITE);
        latido.setRepeatMode(ValueAnimator.REVERSE);
        latido.setInterpolator(new AccelerateDecelerateInterpolator());
        latido.start();
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
            final boolean[] hecho = { false };
            final Runnable trasDibujo = () -> {
                if (hecho[0]) return;
                hecho[0] = true;
                DiagInicio.marca("WebView: la app ya está en pantalla");
                // dos cuadros más: que el dibujo pesado ya haya pasado antes de mover nada
                android.view.Choreographer.getInstance().postFrameCallback(f1 ->
                    android.view.Choreographer.getInstance().postFrameCallback(f2 -> salir(false)));
            };
            try {
                web.postVisualStateCallback(1, new WebView.VisualStateCallback() {
                    @Override public void onComplete(long id) { runOnUiThread(trasDibujo); }
                });
            } catch (Throwable t) { h.postDelayed(trasDibujo, 300); }
            h.postDelayed(trasDibujo, 1200);   // respaldo
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
        if (savedInstanceState == null) DiagInicio.empezar(this, t0);
        // Plugin propio: le dice a la app web si este APK trae Firebase (sin él, registrar avisos cerraría la app).
        registerPlugin(NodoNativoPlugin.class);
        super.onCreate(savedInstanceState);
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
                android.view.Window w = getWindow();
                w.getDecorView().setBackgroundColor(c);
                w.setStatusBarColor(c);
                w.setNavigationBarColor(c);
                androidx.core.view.WindowInsetsControllerCompat ic = androidx.core.view.WindowCompat.getInsetsController(w, w.getDecorView());
                ic.setAppearanceLightStatusBars(claro);
                ic.setAppearanceLightNavigationBars(claro);
                if (wv != null) wv.setBackgroundColor(c);
            } catch (Throwable t) { /* sin tema guardado: el oscuro de siempre */ }
        }
        // Al girar el celular o si Android recrea la pantalla, no se repite
        web = wv;
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
