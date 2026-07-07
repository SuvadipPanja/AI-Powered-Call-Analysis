import {
  readSession,
  getAuthToken,
  persistSession,
  buildLoginSession,
  buildTempLoginSession,
  SESSION_KEYS,
} from "./authSession";

describe("authSession", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("readSession returns empty defaults when storage is empty", () => {
    expect(readSession()).toEqual({
      isLoggedIn: false,
      userId: "",
      username: "",
      userType: "",
      token: "",
      sessionToken: "",
      logId: "",
      loginAlias: "",
      isTempLogin: false,
      email: "",
    });
  });

  it("getAuthToken prefers token then sessionToken", () => {
    localStorage.setItem(SESSION_KEYS.token, "abc");
    expect(getAuthToken()).toBe("abc");
    localStorage.removeItem(SESSION_KEYS.token);
    localStorage.setItem(SESSION_KEYS.sessionToken, "xyz");
    expect(getAuthToken()).toBe("xyz");
  });

  it("persistSession writes login session fields", () => {
    persistSession({
      isLoggedIn: true,
      userId: "9",
      username: "admin",
      userType: "Admin",
      token: "tok-1",
      logId: "42",
      loginAlias: "SUPER001",
    });
    expect(readSession()).toMatchObject({
      isLoggedIn: true,
      userId: "9",
      username: "admin",
      userType: "Admin",
      token: "tok-1",
      logId: "42",
      loginAlias: "SUPER001",
    });
  });

  it("buildLoginSession maps API response and clears temp flag", () => {
    const session = buildLoginSession(
      { userId: "9", username: "admin", userType: "Admin", token: "t", logId: 100 },
      "SUPER001",
    );
    expect(session).toEqual({
      isLoggedIn: true,
      userId: "9",
      loginAlias: "SUPER001",
      username: "admin",
      userType: "Admin",
      token: "t",
      sessionToken: "t",
      logId: "100",
      isTempLogin: false,
    });
  });

  it("buildTempLoginSession marks temp login and stores sessionToken", () => {
    const session = buildTempLoginSession({
      username: "super",
      userType: "Super Admin",
      logId: 7,
      sessionToken: "temp-tok",
      userId: "SUPER001",
    });
    expect(session).toMatchObject({
      isLoggedIn: true,
      userId: "SUPER001",
      isTempLogin: true,
      token: "temp-tok",
      sessionToken: "temp-tok",
      logId: "7",
    });
  });

  it("persistSession removes isTempLogin when set false", () => {
    localStorage.setItem(SESSION_KEYS.isTempLogin, "true");
    persistSession({ isTempLogin: false });
    expect(localStorage.getItem(SESSION_KEYS.isTempLogin)).toBeNull();
  });
});
