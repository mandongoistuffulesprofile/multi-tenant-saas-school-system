-- =============================================================================
-- KICD APPROVED GRADE 5 CBC CURRICULUM SEED FOR MANDONGOI COMPREHENSIVE SCHOOL
-- =============================================================================

CREATE TABLE IF NOT EXISTS kicd_curriculum_strands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grade_level VARCHAR(16) NOT NULL,
    learning_area VARCHAR(64) NOT NULL,
    strand VARCHAR(64) NOT NULL,
    substrand VARCHAR(64) NOT NULL
);

INSERT INTO kicd_curriculum_strands (grade_level, learning_area, strand, substrand) VALUES
('Grade 5', 'Mathematics', 'Numbers', 'Fractions & Decimals'),
('Grade 5', 'Mathematics', 'Measurement', 'Area & Perimeter'),
('Grade 5', 'English Language', 'Listening & Speaking', 'Debating & Formal Speech'),
('Grade 5', 'English Language', 'Reading Comprehension', 'Fluency & Inferences'),
('Grade 5', 'Kiswahili', 'Kusikiliza na Kuzungumza', 'Mijadala na Simulizi'),
('Grade 5', 'Kiswahili', 'Kusoma na Kuandika', 'Insha na Sarufi'),
('Grade 5', 'Science & Technology', 'Living Things', 'Plants & Animal Classification'),
('Grade 5', 'Agriculture & Nutrition', 'Soil Conservation', 'Composting & Mulching'),
('Grade 5', 'Creative Arts', 'Visual Arts', 'Indigenous Crafts & Puppetry')
ON CONFLICT DO NOTHING;
