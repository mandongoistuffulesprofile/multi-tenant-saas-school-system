-- Seed the fixed security-question catalog used by the free password-reset
-- flow. IDs are stable so recovery answers remain valid across deployments.
INSERT INTO public.security_questions (question_id, question_text, display_order) VALUES
    (1, 'What was the name of the street where you grew up?', 1),
    (2, 'What was the name of your first school?', 2),
    (3, 'Who was your first employer?', 3),
    (4, 'What was your favourite teacher''s name?', 4),
    (5, 'What was the name of your first pet?', 5),
    (6, 'In which town was your mother born?', 6),
    (7, 'In which town was your father born?', 7),
    (8, 'What was the model of your first car?', 8),
    (9, 'What was your best childhood friend''s name?', 9),
    (10, 'What was your first phone number?', 10)
ON CONFLICT (question_id) DO NOTHING;

SELECT setval(
    'public.security_questions_question_id_seq',
    GREATEST(COALESCE((SELECT MAX(question_id) FROM public.security_questions), 0), 10)
);
