CREATE TABLE school_terms (
    term_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL,
    calendar_year INT NOT NULL,
    term_name VARCHAR(20) NOT NULL,
    opening_date DATE NOT NULL,
    half_term_start DATE,
    half_term_end DATE,
    closing_date DATE NOT NULL,
    is_current_active_term BOOLEAN DEFAULT FALSE,
    CONSTRAINT unique_tenant_term_year UNIQUE(tenant_id, calendar_year, term_name)
);

CREATE TABLE tenant_branding_settings (
    branding_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL UNIQUE,
    logo_cloud_url VARCHAR(255),
    school_motto VARCHAR(255),
    letterhead_header_text TEXT,
    primary_theme_color_hex VARCHAR(7) DEFAULT '#1A365D',
    custom_receipt_footer_note TEXT
);
