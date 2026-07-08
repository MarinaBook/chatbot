import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { isBasicAuthExemptPath, validateBasicAuth } from "./lib/basic-auth";
import { guestRegex, isDevelopmentEnvironment } from "./lib/constants";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const basicAuthResponse = getBasicAuthResponse(request);

  if (basicAuthResponse) {
    return basicAuthResponse;
  }

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  if (!token) {
    const redirectUrl = encodeURIComponent(new URL(request.url).pathname);

    return NextResponse.redirect(
      new URL(`${base}/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
    );
  }

  const isGuest = guestRegex.test(token?.email ?? "");

  if (token && !isGuest && ["/login", "/register"].includes(pathname)) {
    return NextResponse.redirect(new URL(`${base}/`, request.url));
  }

  return NextResponse.next();
}

function getBasicAuthResponse(request: NextRequest) {
  if (isBasicAuthExemptPath(request.nextUrl.pathname)) {
    return null;
  }

  const result = validateBasicAuth({
    authHeader: request.headers.get("authorization"),
    password: process.env.CHATBOT_BASIC_AUTH_PASSWORD,
    username: process.env.CHATBOT_BASIC_AUTH_USER,
  });

  if (result.ok) {
    return null;
  }

  return new NextResponse(result.message, {
    headers: result.headers,
    status: result.status,
  });
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",

    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
