-- ═══════════════════════════════════════════════════════════════════
-- 0132 · Todo bot nace con las zonas de Lima (y un botón para los que no las tienen)
--
-- Las zonas se cargaron UNA vez en 0032 (julio) sobre los bots que existían. Los creados después
-- —Maestría Digital y Soluciones Practicas, 15-sep— nacieron con `entregas` vacío: un físico en
-- ellos no sabría qué distritos son Lima (contraentrega) y la pestaña Entrega decía «falta aplicar
-- la migración 0032». Ahora la lista base vive en `entregas_base()` (la MISMA de 0032 + adelanto
-- S/ 20 + aéreo apagado), se pone sola al crear un bot, y el panel la usa en «Cargar zonas de Lima».
-- Lo propio de cada negocio (costos por zona, datos del courier) NO va: lo llena cada uno.
-- ═══════════════════════════════════════════════════════════════════
create or replace function entregas_base() returns jsonb
language plpgsql stable
set search_path = public
as $$
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
  return cfg || jsonb_build_object(
    'adelanto_default', 20,
    'aereo', jsonb_build_object('activo', false, 'mensaje', '', 'destinos', '[]'::jsonb),
    'pos_tarjeta', false);
end;
$$;

grant execute on function entregas_base() to authenticated, service_role;

-- Bot nuevo sin entregas → nace con la base (no pisa una configuración que venga en el insert).
create or replace function channels_entregas_por_defecto() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.entregas is null then new.entregas := entregas_base(); end if;
  return new;
end;
$$;

drop trigger if exists trg_channels_entregas_por_defecto on channels;
create trigger trg_channels_entregas_por_defecto before insert on channels
  for each row execute function channels_entregas_por_defecto();
