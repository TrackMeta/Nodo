-- Endurece tres permisos internos que la auditoría de seguridad (2026-09-23) encontró abiertos.
--
-- 1) custom_fields: la LECTURA sigue abierta a todo miembro, pero ESCRIBIR pasa a ser solo del
--    admin. `datos_pago` vive ahí y es el número al que el bot manda a pagar: un operador podía
--    cambiarlo por su propio Yape, y como el validador (ocr_config, solo admin) lo rechazaba,
--    caía a revisión manual… que el mismo operador aprueba. El panel solo escribe estos campos
--    desde Campos e IA, pantallas de admin.
drop policy if exists custom_fields_tenant on custom_fields;
--##--
drop policy if exists custom_fields_sel on custom_fields;
--##--
drop policy if exists custom_fields_admin on custom_fields;
--##--
create policy custom_fields_sel on custom_fields for select using (owns_channel(channel_id));
--##--
create policy custom_fields_admin on custom_fields for all
  using (admin_channel(channel_id)) with check (admin_channel(channel_id));
--##--

-- 2) account_members.created_at lo pone la base, no el que inserta. set_channel_account asigna
--    los bots nuevos a la cuenta MÁS ANTIGUA del usuario: un admin que metía a otra persona en
--    su cuenta con una fecha vieja se quedaba con los bots (y tokens) que esa persona creara.
create or replace function am_fecha_real() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    if tg_op = 'INSERT' then new.created_at := now();
    else new.created_at := old.created_at;
    end if;
  end if;
  return new;
end $$;
--##--
drop trigger if exists trg_am_fecha_real on account_members;
--##--
create trigger trg_am_fecha_real before insert or update on account_members
  for each row execute function am_fecha_real();
--##--

-- 3) channels: el número y la cuenta de WhatsApp (phone_number_id / waba_id) solo se cambian por
--    channel-config, que valida que el token de verdad los controle. Con un UPDATE directo un
--    admin podía ponerse el WABA de otra empresa y quedarse con el webhook de sus plantillas.
create or replace function channels_ids_meta_protegidos() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    if tg_op = 'INSERT' and (new.phone_number_id is not null or new.waba_id is not null) then
      raise exception 'El número de WhatsApp se conecta desde Canales (channel-config)';
    end if;
    if tg_op = 'UPDATE' and (new.phone_number_id is distinct from old.phone_number_id
                          or new.waba_id is distinct from old.waba_id) then
      raise exception 'El número de WhatsApp se cambia desde Canales (channel-config)';
    end if;
  end if;
  return new;
end $$;
--##--
drop trigger if exists trg_channels_ids_meta on channels;
--##--
create trigger trg_channels_ids_meta before insert or update on channels
  for each row execute function channels_ids_meta_protegidos();
