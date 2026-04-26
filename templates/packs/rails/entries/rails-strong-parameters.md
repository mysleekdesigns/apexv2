---
id: rails-strong-parameters
type: convention
title: Every controller action that mutates state goes through Strong Parameters
applies_to: team
confidence: high
sources:
  - kind: manual
    ref: "manual/rails-pack-maintainers"
created: 2026-04-26
last_validated: 2026-04-26
tags: [rails, security, controllers, mass-assignment]
rule: Define a private `*_params` method per controller that calls `params.require(...).permit(...)` listing exactly the attributes the action may mass-assign. Never pass raw `params` into `Model.new` / `update` / `create`.
enforcement: lint
scope:
  - "app/controllers/**/*.rb"
---

**Why:** Mass-assignment vulnerabilities are the canonical Rails footgun. Without Strong Parameters, an attacker can POST `user[admin]=true` and silently elevate privileges. `permit` is the explicit allow-list that closes that hole.

**How to apply:**

```ruby
class UsersController < ApplicationController
  def create
    @user = User.new(user_params)   # NOT User.new(params[:user])
    if @user.save
      redirect_to @user
    else
      render :new, status: :unprocessable_entity
    end
  end

  private

  def user_params
    params.require(:user).permit(:email, :name, :avatar)
  end
end
```

For nested attributes use the array form: `permit(:title, items_attributes: [:id, :name, :_destroy])`. Never use `permit!` (which permits all attributes) on user-controlled input.

**Lint:** RuboCop's `Rails/StrongParametersExpect` (enable it) flags missing `*_params` methods on standard CRUD actions.
