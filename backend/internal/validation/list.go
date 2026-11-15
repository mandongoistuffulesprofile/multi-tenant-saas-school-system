package validation

// List guarantees a JSON array.
//
// A nil slice marshals as null, and a client that expects a list either throws
// or renders an empty table it cannot tell apart from a successful empty
// response: the holding tank, gate tags, platform usage, platform subscriptions
// and report cards each spent time as a working screen that looked broken for
// exactly this reason. Wrapping the value on the way out is cheaper and safer
// than remembering to initialise every slice in every query.
//
// Use it at the handler boundary: c.JSON(http.StatusOK, validation.List(rows)).
func List[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}
