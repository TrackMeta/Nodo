-- Nodo · 0032 — Zonas de entrega de Lima + reglas duras (Fase 4)
--
-- La lista NO es el mapa político de Lima: es la lista REAL de entrega del
-- negocio. Los clientes escriben "Huaycán", "Salamanca", "Santa Clara",
-- "Chosica" o "Manchay" — no "Ate" ni "Lurigancho". Con el mapa oficial la IA
-- fallaría con la mitad de los clientes reales. Incluye 3 lugares que ni
-- siquiera son Lima Metropolitana (Jicamarca, Ricardo Palma y Santa Eulalia son
-- de Huarochirí) porque el negocio SÍ entrega ahí.
--
-- Lo que NO está en la lista → Provincia (agencia), automático.
--
-- Todo esto lo evalúa CÓDIGO, no la IA: la IA solo interpreta qué lugar dijo el
-- cliente; si cubrimos, si llega hoy y si ya pasó la hora de corte lo decide el
-- motor contra esta configuración. Un toggle tiene que ser una regla, no una
-- sugerencia que un modelo puede ignorar.
alter table channels add column if not exists entregas jsonb;

do $$
declare cfg jsonb;
begin
  cfg := jsonb_build_object(
    'envio_gratis', true,                  -- el negocio siempre ofrece envío gratis
    'corte', '11:00',                      -- hora de corte para entrega el mismo día
    'dias', jsonb_build_object('lun',true,'mar',true,'mie',true,'jue',true,'vie',true,'sab',true),
    'domingos', false,
    'feriados', false,
    'feriados_fechas', '[]'::jsonb,        -- ISO 'YYYY-MM-DD' que se consideran feriado
    'horario', jsonb_build_object('desde','09:00','hasta','19:00'),
    'zonas', (
      select jsonb_agg(jsonb_build_object(
        'nombre', t.nombre, 'grupo', t.grupo, 'cubro', t.cubro,
        'mismo_dia', false, 'alias', t.alias) order by t.nombre)
      from (values
        -- ── Lima Centro ──
        ('CERCADO DE LIMA','centro',true,'["LIMA CERCADO","CENTRO DE LIMA","CERCADO"]'::jsonb),
        ('BREÑA','centro',true,'[]'::jsonb),
        ('LA VICTORIA','centro',true,'[]'::jsonb),
        ('RIMAC','centro',true,'["RÍMAC"]'::jsonb),
        ('SAN LUIS','centro',true,'[]'::jsonb),
        -- ── Lima Moderna ──
        ('BARRANCO','moderna',true,'[]'::jsonb),
        ('JESUS MARIA','moderna',true,'["JESÚS MARÍA"]'::jsonb),
        ('LA MOLINA','moderna',true,'[]'::jsonb),
        ('LINCE','moderna',true,'[]'::jsonb),
        ('MAGDALENA DEL MAR','moderna',true,'["MAGDALENA"]'::jsonb),
        ('MIRAFLORES','moderna',true,'[]'::jsonb),
        ('PUEBLO LIBRE','moderna',true,'[]'::jsonb),
        ('SAN BORJA','moderna',true,'[]'::jsonb),
        ('SAN ISIDRO','moderna',true,'[]'::jsonb),
        ('SAN MIGUEL','moderna',true,'[]'::jsonb),
        ('SANTIAGO DE SURCO','moderna',true,'["SURCO"]'::jsonb),
        ('SURQUILLO','moderna',true,'[]'::jsonb),
        -- ── Lima Norte ──
        ('ANCON','norte',true,'["ANCÓN"]'::jsonb),
        ('CARABAYLLO','norte',true,'[]'::jsonb),
        ('COMAS','norte',true,'[]'::jsonb),
        ('INDEPENDENCIA','norte',true,'[]'::jsonb),
        ('LOS OLIVOS','norte',true,'[]'::jsonb),
        ('PUENTE PIEDRA','norte',true,'[]'::jsonb),
        ('SAN MARTIN DE PORRES','norte',true,'["SMP","SAN MARTÍN DE PORRES"]'::jsonb),
        ('SANTA ROSA','norte',true,'[]'::jsonb),
        -- ── Lima Sur ──
        ('CHORRILLOS','sur',true,'[]'::jsonb),
        ('LURIN','sur',true,'["LURÍN"]'::jsonb),
        ('MANCHAY','sur',true,'[]'::jsonb),
        ('PACHACAMAC','sur',true,'["PACHACÁMAC"]'::jsonb),
        ('PUNTA NEGRA','sur',true,'[]'::jsonb),
        ('SAN JUAN DE MIRAFLORES','sur',true,'["SJM"]'::jsonb),
        ('SANTA MARIA DEL MAR','sur',true,'["SANTA MARIA","SANTA MARÍA DEL MAR"]'::jsonb),
        ('VILLA EL SALVADOR','sur',true,'["VES"]'::jsonb),
        ('VILLA MARIA DEL TRIUNFO','sur',true,'["VMT","VILLA MARÍA DEL TRIUNFO"]'::jsonb),
        -- Playas del sur: agregadas pero APAGADAS (decisión de Rodrigo).
        ('PUCUSANA','sur',false,'[]'::jsonb),
        ('PUNTA HERMOSA','sur',false,'[]'::jsonb),
        ('SAN BARTOLO','sur',false,'[]'::jsonb),
        -- ── Lima Este ──
        ('ATE','este',true,'["ATE VITARTE","VITARTE"]'::jsonb),
        ('CAJAMARQUILLA','este',true,'[]'::jsonb),
        ('CARAPONGO','este',true,'[]'::jsonb),
        ('CHACLACAYO','este',true,'[]'::jsonb),
        ('CHOSICA','este',true,'["LURIGANCHO CHOSICA"]'::jsonb),
        ('CIENEGUILLA','este',true,'[]'::jsonb),
        ('EL AGUSTINO','este',true,'["AGUSTINO"]'::jsonb),
        ('HUACHIPA','este',true,'[]'::jsonb),
        ('HUAYCAN','este',true,'["HUAYCÁN"]'::jsonb),
        ('JICAMARCA','este',true,'[]'::jsonb),
        ('JICAMARCA - ANEXO 22SJL','este',true,'["ANEXO 22","JICAMARCA 22"]'::jsonb),
        ('JICAMARCA - ANEXO 8 HUACHIPA','este',true,'["ANEXO 8","JICAMARCA 8"]'::jsonb),
        ('LURIGANCHO','este',true,'[]'::jsonb),
        ('RICARDO PALMA','este',true,'[]'::jsonb),
        ('SALAMANCA ATE','este',true,'["SALAMANCA"]'::jsonb),
        ('SAN JUAN DE LURIGANCHO','este',true,'["SJL","SAN JUAN LURIGANCHO"]'::jsonb),
        ('SANTA ANITA','este',true,'[]'::jsonb),
        ('SANTA CLARA - ATE','este',true,'["SANTA CLARA"]'::jsonb),
        ('SANTA EULALIA','este',true,'[]'::jsonb),
        -- ── Callao ── (mismo día apagado; activable)
        ('BELLAVISTA','callao',true,'[]'::jsonb),
        ('CALLAO','callao',true,'[]'::jsonb),
        ('CARMEN DE LA LEGUA REYNOSO','callao',true,'["CARMEN DE LA LEGUA"]'::jsonb),
        ('LA PERLA','callao',true,'[]'::jsonb),
        ('LA PUNTA','callao',true,'[]'::jsonb),
        ('MARQUEZ - CALLAO','callao',true,'["MARQUEZ","MÁRQUEZ"]'::jsonb),
        ('MI PERU','callao',true,'["MI PERÚ"]'::jsonb),
        ('VENTANILLA','callao',true,'[]'::jsonb)
      ) as t(nombre, grupo, cubro, alias)
    )
  );
  -- Solo los canales que aún no tienen configuración (no pisar la de nadie).
  update channels set entregas = cfg where entregas is null;
end $$;
