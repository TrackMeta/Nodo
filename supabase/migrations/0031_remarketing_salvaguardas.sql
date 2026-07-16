-- Nodo · 0031 — Salvaguardas del remarketing (Fase 3 del rediseño de ventas)
--
-- Requisito 2: si el cliente dice claramente que ya no quiere ("no me interesa",
-- "no escriban"), hay que RESPETARLO y apagarle las secuencias. Y el que ya
-- compró también sale: mandarle "última oportunidad" a alguien que te acaba de
-- pagar es vergonzoso.
--
-- Requisito 16: no mandar remarketing a las 3am.

-- Opt-out del contacto. Lo marca el motor al detectar desinterés explícito, y
-- se puede desmarcar a mano desde la Bandeja si fue un malentendido.
alter table contacts add column if not exists no_remarketing boolean not null default false;

-- Horario permitido para el remarketing, por canal (hora local del negocio):
--   { activo: bool, desde: "09:00", hasta: "21:00" }
-- Si no está configurado, se manda a cualquier hora (comportamiento actual).
alter table channels add column if not exists remarketing jsonb;

-- El scheduler filtra por estas dos en cada tick.
create index if not exists idx_contacts_no_remarketing on contacts(no_remarketing) where no_remarketing = true;
