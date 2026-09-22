'use server';
import { redirect } from 'next/navigation';
import { env } from '../../lib/env';
import { DEMO_USERS, type DemoRole } from '../../lib/demo';
import { supabaseServer } from '../../lib/supabase/server';

export async function signIn(_: string | null, form: FormData): Promise<string | null> {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get('email') ?? ''),
    password: String(form.get('password') ?? ''),
  });
  if (error) return 'Email or password is wrong.';
  redirect('/');
}

export async function signInDemo(role: DemoRole) {
  const password = env.demoPassword;
  if (!password) throw new Error('Demo sign-in is disabled on this environment');
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email: DEMO_USERS[role], password });
  if (error) redirect('/login?error=demo');
  redirect(role === 'sales' ? '/orders/new' : '/');
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect('/login');
}
