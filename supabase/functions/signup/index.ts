import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Banned IPs
const BANNED_IPS = new Set([
  "217.154.161.167",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check banned IP
    const forwarded = req.headers.get("x-forwarded-for");
    const clientIp = forwarded?.split(",")[0]?.trim() || "";
    if (BANNED_IPS.has(clientIp)) {
      console.warn(`Blocked signup from banned IP: ${clientIp}`);
      return new Response(
        JSON.stringify({ error: "Signup is not available from your location" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, password, username, captchaToken } = await req.json();

    // Validate required fields
    if (!email || !password || !username || !captchaToken) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate username server-side
    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3) {
      return new Response(
        JSON.stringify({ error: "Username must be at least 3 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (trimmedUsername.length > 30) {
      return new Response(
        JSON.stringify({ error: "Username must be at most 30 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      return new Response(
        JSON.stringify({ error: "Username can only contain letters, numbers, and underscores" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify Turnstile captcha
    const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!turnstileSecret) {
      console.error("TURNSTILE_SECRET_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const verifyResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: turnstileSecret, response: captchaToken }),
      }
    );
    const verifyResult = await verifyResponse.json();

    if (!verifyResult.success) {
      console.warn("Turnstile verification failed:", verifyResult);
      return new Response(
        JSON.stringify({ error: "Captcha verification failed. Please try again." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create user via service role (bypasses auth restrictions)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if username is already taken
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("username", trimmedUsername)
      .maybeSingle();

    if (existingProfile) {
      return new Response(
        JSON.stringify({ error: "Username is already taken" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create the user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: trimmedUsername },
    });

    if (authError) {
      console.error("User creation error:", authError);
      // Forward common errors nicely
      if (authError.message?.includes("already been registered")) {
        return new Response(
          JSON.stringify({ error: "An account with this email already exists" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: authError.message || "Failed to create account" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sign the user in to get a session
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      console.error("Sign-in after signup error:", signInError);
      // Account was created but sign-in failed; user can try logging in manually
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Account created! Please log in.",
          session: null 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`User created successfully: ${authData.user.id} (${trimmedUsername})`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        session: signInData.session,
        user: signInData.user,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Signup error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
