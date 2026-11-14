import { SignJWT, jwtVerify } from "jose";

/**
 * Local-mode session token helpers. Pure (no next/headers), so proxy.ts can use them.
 * The token only carries the user id; the role is always re-read server-side.
 */
export const LOCAL_SESSION_COOKIE = "toofi_session";
export const LOCAL_SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const ISSUER = "toofi-local";
const AUDIENCE = "toofi";

export async function signLocalSession(userId: string, secret: Uint8Array): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${LOCAL_SESSION_MAX_AGE}s`)
    .sign(secret);
}

export async function verifyLocalSession(token: string, secret: Uint8Array): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    return typeof payload.sub === "string" ? { sub: payload.sub } : null;
  } catch {
    return null;
  }
}
