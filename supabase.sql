BEGIN;

CREATE TABLE IF NOT EXISTS public.members (
    id          SERIAL PRIMARY KEY,
    member_code VARCHAR(20) NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(100),
    phone       VARCHAR(20),
    join_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    status      VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT members_email_format CHECK (
        email IS NULL OR email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    ),
    CONSTRAINT members_phone_format CHECK (
        phone IS NULL OR phone ~ '^[0-9+() .-]{7,20}$'
    )
);

CREATE TABLE IF NOT EXISTS public.packages (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(50) NOT NULL UNIQUE,
    duration_months INTEGER NOT NULL CHECK (duration_months > 0),
    duration_days   INTEGER NOT NULL CHECK (duration_days > 0),
    price           NUMERIC(15,2) NOT NULL CHECK (price > 0),
    tax_rate        NUMERIC(5,2) NOT NULL DEFAULT 11.00
                    CHECK (tax_rate >= 0 AND tax_rate <= 100),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sales (
    id             SERIAL PRIMARY KEY,
    sales_no       VARCHAR(30) NOT NULL UNIQUE,
    member_id      INTEGER NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    package_id     INTEGER NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
    start_date     DATE NOT NULL,
    end_date       DATE NOT NULL,
    price_paid     NUMERIC(15,2) NOT NULL CHECK (price_paid > 0),
    tax_rate       NUMERIC(5,2) NOT NULL CHECK (tax_rate >= 0 AND tax_rate <= 100),
    tax_amount     NUMERIC(15,2) NOT NULL CHECK (tax_amount >= 0),
    revenue_amount NUMERIC(15,2) NOT NULL CHECK (revenue_amount >= 0),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'transfer')),
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sales_dates_valid CHECK (end_date >= start_date),
    CONSTRAINT sales_inclusive_tax_math CHECK (
        revenue_amount = ROUND(price_paid / (1 + tax_rate / 100), 2)
        AND tax_amount = ROUND(price_paid - revenue_amount, 2)
    )
);

CREATE TABLE IF NOT EXISTS public.journals (
    id             SERIAL PRIMARY KEY,
    journal_no     VARCHAR(30) NOT NULL UNIQUE,
    journal_date   DATE NOT NULL,
    description    TEXT NOT NULL,
    reference_type VARCHAR(20) NOT NULL CHECK (reference_type = 'sale'),
    reference_id   INTEGER NOT NULL UNIQUE
                   REFERENCES public.sales(id) ON DELETE RESTRICT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.journal_entries (
    id           SERIAL PRIMARY KEY,
    journal_id   INTEGER NOT NULL REFERENCES public.journals(id) ON DELETE RESTRICT,
    account_code VARCHAR(10) NOT NULL,
    account_name VARCHAR(50) NOT NULL,
    debit        NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    description  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT journal_entry_account_valid CHECK (
        (account_code = '1-1000' AND account_name = 'Kas & Bank') OR
        (account_code = '2-2000' AND account_name = 'PPN Keluaran') OR
        (account_code = '4-4000' AND account_name = 'Pendapatan Membership')
    ),
    CONSTRAINT journal_entry_one_side CHECK (
        NOT (debit > 0 AND credit > 0)
    )
);

ALTER TABLE public.journal_entries
    DROP CONSTRAINT IF EXISTS journal_entry_one_side;
ALTER TABLE public.journal_entries
    ADD CONSTRAINT journal_entry_one_side CHECK (
        NOT (debit > 0 AND credit > 0)
    );

CREATE INDEX IF NOT EXISTS sales_member_id_idx ON public.sales(member_id);
CREATE INDEX IF NOT EXISTS sales_package_id_idx ON public.sales(package_id);
CREATE INDEX IF NOT EXISTS sales_start_date_idx ON public.sales(start_date);
CREATE INDEX IF NOT EXISTS sales_end_date_idx ON public.sales(end_date);
CREATE INDEX IF NOT EXISTS journals_journal_date_idx ON public.journals(journal_date);
CREATE INDEX IF NOT EXISTS journal_entries_journal_id_idx ON public.journal_entries(journal_id);

CREATE OR REPLACE FUNCTION public.validate_journal_entries_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_journal_id INTEGER;
    journal_ids       INTEGER[];
    entry_count       INTEGER;
    total_debit       NUMERIC(15,2);
    total_credit      NUMERIC(15,2);
BEGIN
    IF TG_OP = 'INSERT' THEN
        journal_ids := ARRAY[NEW.journal_id];
    ELSIF TG_OP = 'DELETE' THEN
        journal_ids := ARRAY[OLD.journal_id];
    ELSE
        journal_ids := ARRAY[OLD.journal_id, NEW.journal_id];
    END IF;

    FOREACH target_journal_id IN ARRAY journal_ids LOOP
        SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
          INTO entry_count, total_debit, total_credit
          FROM public.journal_entries
         WHERE journal_id = target_journal_id;

        IF entry_count < 2 THEN
            RAISE EXCEPTION 'Jurnal % harus memiliki minimal 2 baris', target_journal_id;
        END IF;

        IF ABS(total_debit - total_credit) > 0.01 THEN
            RAISE EXCEPTION 'Jurnal % tidak seimbang: debit %, kredit %',
                target_journal_id, total_debit, total_credit;
        END IF;
    END LOOP;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS journal_entries_balance_check ON public.journal_entries;
CREATE CONSTRAINT TRIGGER journal_entries_balance_check
AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_journal_entries_balance();

CREATE OR REPLACE FUNCTION public.assign_member_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.member_code IS NULL OR NEW.member_code = '' THEN
        NEW.member_code := 'MBR-' || LPAD(NEW.id::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS members_assign_code ON public.members;
CREATE TRIGGER members_assign_code
BEFORE INSERT ON public.members
FOR EACH ROW EXECUTE FUNCTION public.assign_member_code();

CREATE OR REPLACE FUNCTION public.create_sale_with_journal(
    p_member_id INTEGER,
    p_package_id INTEGER,
    p_start_date DATE,
    p_payment_method VARCHAR,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_member_name       VARCHAR(100);
    v_package_name      VARCHAR(50);
    v_duration_days     INTEGER;
    v_price             NUMERIC(15,2);
    v_tax_rate          NUMERIC(5,2);
    v_revenue_amount    NUMERIC(15,2);
    v_tax_amount        NUMERIC(15,2);
    v_month             TEXT;
    v_sales_prefix      TEXT;
    v_journal_prefix    TEXT;
    v_sequence          BIGINT;
    v_sales_no          VARCHAR(30);
    v_journal_no        VARCHAR(30);
    v_description       TEXT;
    v_sale_id           INTEGER;
    v_journal_id        INTEGER;
    v_result            JSONB;
BEGIN
    IF p_start_date IS NULL THEN
        RAISE EXCEPTION 'Tanggal mulai wajib diisi';
    END IF;
    IF p_payment_method NOT IN ('cash', 'transfer') THEN
        RAISE EXCEPTION 'Metode pembayaran hanya cash atau transfer';
    END IF;

    SELECT name INTO v_member_name
      FROM public.members
     WHERE id = p_member_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member tidak ditemukan';
    END IF;

    SELECT name, duration_days, price, tax_rate
      INTO v_package_name, v_duration_days, v_price, v_tax_rate
      FROM public.packages
     WHERE id = p_package_id AND is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Paket aktif tidak ditemukan';
    END IF;

    v_month := TO_CHAR(p_start_date, 'YYYYMM');
    v_sales_prefix := 'SLS-' || v_month;
    v_journal_prefix := 'JV-' || v_month;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_sales_prefix, 0));
    SELECT COALESCE(MAX(SUBSTRING(sales_no FROM '[0-9]+$')::BIGINT), 0) + 1
      INTO v_sequence
      FROM public.sales
     WHERE sales_no LIKE v_sales_prefix || '-%';
    v_sales_no := v_sales_prefix || '-' || LPAD(v_sequence::TEXT, 4, '0');

    v_revenue_amount := ROUND(v_price / (1 + v_tax_rate / 100), 2);
    v_tax_amount := ROUND(v_price - v_revenue_amount, 2);

    INSERT INTO public.sales (
        sales_no, member_id, package_id, start_date, end_date,
        price_paid, tax_rate, tax_amount, revenue_amount,
        payment_method, notes
    ) VALUES (
        v_sales_no, p_member_id, p_package_id, p_start_date,
        p_start_date + v_duration_days,
        v_price, v_tax_rate, v_tax_amount, v_revenue_amount,
        p_payment_method, p_notes
    ) RETURNING id INTO v_sale_id;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_journal_prefix, 0));
    SELECT COALESCE(MAX(SUBSTRING(journal_no FROM '[0-9]+$')::BIGINT), 0) + 1
      INTO v_sequence
      FROM public.journals
     WHERE journal_no LIKE v_journal_prefix || '-%';
    v_journal_no := v_journal_prefix || '-' || LPAD(v_sequence::TEXT, 4, '0');
    v_description := 'Penjualan paket ' || v_package_name || ' - ' || v_member_name;

    INSERT INTO public.journals (
        journal_no, journal_date, description, reference_type, reference_id
    ) VALUES (
        v_journal_no, p_start_date, v_description, 'sale', v_sale_id
    ) RETURNING id INTO v_journal_id;

    INSERT INTO public.journal_entries (
        journal_id, account_code, account_name, debit, credit, description
    ) VALUES
        (v_journal_id, '1-1000', 'Kas & Bank', v_price, 0, v_description),
        (v_journal_id, '4-4000', 'Pendapatan Membership', 0, v_revenue_amount, v_description),
        (v_journal_id, '2-2000', 'PPN Keluaran', 0, v_tax_amount, v_description);

    IF ABS(v_price - v_revenue_amount - v_tax_amount) > 0.01 THEN
        RAISE EXCEPTION 'Jurnal tidak seimbang';
    END IF;

    UPDATE public.members SET status = 'active' WHERE id = p_member_id;

    SELECT TO_JSONB(s) || JSONB_BUILD_OBJECT(
        'journal', TO_JSONB(j),
        'journal_entries', COALESCE((
            SELECT JSONB_AGG(TO_JSONB(je) ORDER BY je.id)
              FROM public.journal_entries je
             WHERE je.journal_id = j.id
        ), '[]'::JSONB)
    )
      INTO v_result
      FROM public.sales s
      JOIN public.journals j ON j.reference_id = s.id
     WHERE s.id = v_sale_id;

    RETURN v_result;
END;
$$;

INSERT INTO public.packages (name, duration_months, duration_days, price, tax_rate, is_active)
VALUES
    ('1 Bulan', 1, 30, 500000.00, 11.00, TRUE),
    ('3 Bulan', 3, 90, 1350000.00, 11.00, TRUE),
    ('6 Bulan', 6, 180, 2500000.00, 11.00, TRUE),
    ('1 Tahun', 12, 365, 4500000.00, 11.00, TRUE)
ON CONFLICT (name) DO UPDATE SET
    duration_months = EXCLUDED.duration_months,
    duration_days = EXCLUDED.duration_days,
    price = EXCLUDED.price,
    tax_rate = EXCLUDED.tax_rate,
    is_active = EXCLUDED.is_active;

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS members_uat_access ON public.members;
CREATE POLICY members_uat_access ON public.members
    FOR ALL TO anon USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS packages_uat_access ON public.packages;
CREATE POLICY packages_uat_access ON public.packages
    FOR ALL TO anon USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS sales_select_uat ON public.sales;
CREATE POLICY sales_select_uat ON public.sales
    FOR SELECT TO anon USING (TRUE);
DROP POLICY IF EXISTS sales_insert_uat ON public.sales;
CREATE POLICY sales_insert_uat ON public.sales
    FOR INSERT TO anon WITH CHECK (TRUE);
DROP POLICY IF EXISTS sales_update_uat ON public.sales;
CREATE POLICY sales_update_uat ON public.sales
    FOR UPDATE TO anon USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS sales_delete_uat ON public.sales;
CREATE POLICY sales_delete_uat ON public.sales
    FOR DELETE TO anon
    USING (NOT EXISTS (
        SELECT 1 FROM public.journals WHERE reference_id = sales.id
    ));

DROP POLICY IF EXISTS journals_select_uat ON public.journals;
CREATE POLICY journals_select_uat ON public.journals
    FOR SELECT TO anon USING (TRUE);
DROP POLICY IF EXISTS journals_insert_uat ON public.journals;
CREATE POLICY journals_insert_uat ON public.journals
    FOR INSERT TO anon WITH CHECK (TRUE);

DROP POLICY IF EXISTS journal_entries_select_uat ON public.journal_entries;
CREATE POLICY journal_entries_select_uat ON public.journal_entries
    FOR SELECT TO anon USING (TRUE);
DROP POLICY IF EXISTS journal_entries_insert_uat ON public.journal_entries;
CREATE POLICY journal_entries_insert_uat ON public.journal_entries
    FOR INSERT TO anon WITH CHECK (TRUE);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.members TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.packages TO anon;
GRANT SELECT, INSERT, DELETE ON public.sales TO anon;
GRANT UPDATE (notes) ON public.sales TO anon;
GRANT SELECT, INSERT ON public.journals TO anon;
GRANT SELECT, INSERT ON public.journal_entries TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
REVOKE ALL ON FUNCTION public.create_sale_with_journal(INTEGER, INTEGER, DATE, VARCHAR, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sale_with_journal(INTEGER, INTEGER, DATE, VARCHAR, TEXT) TO anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
