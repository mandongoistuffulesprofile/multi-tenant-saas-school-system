package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ErrInvalidToken is returned for malformed or unverifiable access tokens.
var ErrInvalidToken = errors.New("invalid access token")

const (
	// TokenIssuer and TokenAudience bind a token to this service. Changing
	// either invalidates every outstanding token, which is intentional.
	TokenIssuer   = "skulapp"
	TokenAudience = "skulapp-api"

	TokenTypeAccess  = "access"
	TokenTypeRefresh = "refresh"
)

type Claims struct {
	UserID    string   `json:"user_id"`
	TenantID  string   `json:"tenant_id,omitempty"`
	Roles     []string `json:"roles"`
	TokenType string   `json:"token_type,omitempty"`
	jwt.RegisteredClaims
}

type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

type JWTManager struct {
	signingKey []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewJWTManager(signingKey string, accessTTL, refreshTTL time.Duration) *JWTManager {
	return &JWTManager{
		signingKey: []byte(signingKey),
		accessTTL:  accessTTL,
		refreshTTL: refreshTTL,
	}
}

// RefreshTTL is the lifetime of refresh tokens issued by this manager.
func (jm *JWTManager) RefreshTTL() time.Duration { return jm.refreshTTL }

func (jm *JWTManager) GenerateTokenPair(userID, tenantID string, roles []string) (*TokenPair, error) {
	now := time.Now()

	accessClaims := &Claims{
		UserID:    userID,
		TenantID:  tenantID,
		Roles:     roles,
		TokenType: TokenTypeAccess,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    TokenIssuer,
			Audience:  jwt.ClaimStrings{TokenAudience},
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(jm.accessTTL)),
			NotBefore: jwt.NewNumericDate(now),
		},
	}

	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
	accessTokenString, err := accessToken.SignedString(jm.signingKey)
	if err != nil {
		return nil, fmt.Errorf("failed to sign access token: %w", err)
	}

	refreshClaims := &Claims{
		UserID:    userID,
		TenantID:  tenantID,
		TokenType: TokenTypeRefresh,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    TokenIssuer,
			Audience:  jwt.ClaimStrings{TokenAudience},
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(jm.refreshTTL)),
			NotBefore: jwt.NewNumericDate(now),
		},
	}

	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refreshTokenString, err := refreshToken.SignedString(jm.signingKey)
	if err != nil {
		return nil, fmt.Errorf("failed to sign refresh token: %w", err)
	}

	return &TokenPair{
		AccessToken:  accessTokenString,
		RefreshToken: refreshTokenString,
		ExpiresIn:    int64(jm.accessTTL.Seconds()),
	}, nil
}

func (jm *JWTManager) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return jm.signingKey, nil
	},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(TokenIssuer),
		jwt.WithAudience(TokenAudience),
		jwt.WithLeeway(60*time.Second),
	)
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	return claims, nil
}
