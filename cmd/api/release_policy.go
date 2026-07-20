package main

import (
	"net/http"

	"blockxone/internal/releasepolicy"

	"github.com/gin-gonic/gin"
)

// releaseOneRouteGuard runs before endpoint authorization so hidden links,
// direct URLs and even otherwise privileged principals receive the same
// fail-closed result. A 404 avoids advertising disabled capabilities.
func releaseOneRouteGuard(appEnv string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, blocked := releasepolicy.BlockedCapability(appEnv, c.Request.Method, c.Request.URL.Path); blocked {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.Next()
	}
}
