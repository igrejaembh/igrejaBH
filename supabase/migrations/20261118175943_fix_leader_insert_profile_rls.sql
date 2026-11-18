-- Fix RLS policy on public.profiles INSERT for Tier 2 home group leaders.
-- Previously, unqualified `home_group_id` inside the EXISTS subquery bound to `leader.home_group_id`
-- instead of the inserted row's `profiles.home_group_id`.

DROP POLICY IF EXISTS "Liderança pode inserir perfis" ON public.profiles;

CREATE POLICY "Liderança pode inserir perfis"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  -- Tier 3: Dev, Presbyter, Deacon
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
    AND (p.is_dev = true OR p.is_presbyter = true OR p.is_deacon = true)
  )
  OR
  -- Tier 2: Leader inserting into their own home group
  (
    profiles.home_group_id IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM public.home_groups hg
      JOIN public.profiles leader ON (hg.leader_1_id = leader.id OR hg.leader_2_id = leader.id)
      WHERE leader.user_id = auth.uid()
      AND hg.id = profiles.home_group_id
    )
  )
);
