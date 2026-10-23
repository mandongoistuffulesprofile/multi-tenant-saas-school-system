package auth

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

const (
	AccessCookie  = "access_token"
	RefreshCookie = "refresh_token"
	CSRFCookie    = "csrf_token"
)

// setSessionCookies writes the browser session. Access and refresh tokens are
// HttpOnly so XSS cannot read them; the CSRF token is deliberately readable by
// JavaScript so the SPA can echo it in the X-CSRF-Token header (double submit).
func (h *Handler) setSessionCookies(c *gin.Context, pair *TokenPair) {
	secure := os.Getenv("APP_ENV") == "production" || c.GetHeader("X-Forwarded-Proto") == "https"

	accessMaxAge := int(pair.ExpiresIn)
	if accessMaxAge <= 0 {
		accessMaxAge = 15 * 60
	}
	refreshMaxAge := int(h.jwt.RefreshTTL().Seconds())
	if refreshMaxAge <= 0 {
		refreshMaxAge = 30 * 24 * 60 * 60
	}

	http.SetCookie(c.Writer, &http.Cookie{
		Name:     AccessCookie,
		Value:    pair.AccessToken,
		Path:     "/",
		MaxAge:   accessMaxAge,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     RefreshCookie,
		Value:    pair.RefreshToken,
		Path:     "/api/v1/auth",
		MaxAge:   refreshMaxAge,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     CSRFCookie,
		Value:    GenerateResetToken(),
		Path:     "/",
		MaxAge:   refreshMaxAge,
		HttpOnly: false,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearSessionCookies(c *gin.Context) {
	for _, cookie := range []struct{ name, path string }{
		{AccessCookie, "/"},
		{RefreshCookie, "/api/v1/auth"},
		{CSRFCookie, "/"},
	} {
		http.SetCookie(c.Writer, &http.Cookie{
			Name:     cookie.name,
			Value:    "",
			Path:     cookie.path,
			MaxAge:   -1,
			HttpOnly: cookie.name != CSRFCookie,
			Secure:   os.Getenv("APP_ENV") == "production" || c.GetHeader("X-Forwarded-Proto") == "https",
			SameSite: http.SameSiteLaxMode,
		})
	}
}
