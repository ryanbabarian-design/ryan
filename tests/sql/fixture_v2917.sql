INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-a000-000000000001','admin@example.test'),
 ('00000000-0000-4000-a000-000000000002','team@example.test'),
 ('00000000-0000-4000-a000-000000000003','exec@example.test'),
 ('00000000-0000-4000-a000-000000000004','ceo@example.test');
INSERT INTO public.admins(user_id,display_name) VALUES ('00000000-0000-4000-a000-000000000001','관리자');
INSERT INTO public.proposal_intake_settings(id) VALUES(1);
INSERT INTO public.employees(name,department) VALUES('신규', '생산'),('기존','연구');
INSERT INTO public.approval_steps(id,step_order,role_name,auto_author) VALUES
 (1,1,'담당',true),(2,2,'부서장',false),(3,3,'해당부서 임원',false),(4,4,'대표이사',false);
INSERT INTO public.approval_assignments(step_id,user_id,display_name,email,department) VALUES
 (2,'00000000-0000-4000-a000-000000000002','부서장 이름','team@example.test','생산'),
 (3,'00000000-0000-4000-a000-000000000003','임원 이름','exec@example.test','생산'),
 (4,'00000000-0000-4000-a000-000000000004','대표 이름','ceo@example.test',NULL);
