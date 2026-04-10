import { signIn, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';

export async function login(username: string, password: string) {
  return signIn({ username, password });
}

export async function logout() {
  return signOut();
}

export async function getUser() {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}

export async function getToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() || null;
  } catch {
    return null;
  }
}
