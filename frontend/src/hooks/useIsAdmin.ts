import { useEffect, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

const ADMIN_GROUP = 'admins';

/**
 * Resolve current user's Cognito groups and expose whether the user
 * is in the `admins` group. Only admins may modify system config.
 */
export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [groups, setGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchAuthSession()
      .then((session) => {
        // cognito:groups lives on both id and access tokens; prefer id.
        const payload = session.tokens?.idToken?.payload as Record<string, unknown> | undefined;
        const raw = payload?.['cognito:groups'];
        const list: string[] = Array.isArray(raw) ? (raw as string[]) : [];
        if (!mounted) return;
        setGroups(list);
        setIsAdmin(list.includes(ADMIN_GROUP));
      })
      .catch(() => {
        if (!mounted) return;
        setGroups([]);
        setIsAdmin(false);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return { isAdmin, groups, loading };
}

export default useIsAdmin;
