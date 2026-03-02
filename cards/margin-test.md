---
name: Margin Test
width: 380
height: 500
progressBar: true
---

[[margin(left, type: absolute)]]
{
**Margin Test**
}

[[margin(right, type: absolute, pos: 20)]]
{
Fixed at 20px
}

[[margin(right, type: absolute, pos: 120)]]
{
Fixed at 120px
}

# Margin System Test

This card tests the margin layout system with various configurations.

---

## Section One

[[margin(right, type: relative, orient: horizontal)]]
{
This is a **relative horizontal** margin on the right. It should track near this section as you scroll.
}

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. [[note(top, orient: horizontal)]]{horizontal}{
This is a **horizontal** note with multi-line content.
It should render as horizontal text on the right side.
It should render as horizontal text on the right side.
It should render as horizontal text on the right side.
It should render as horizontal text on the right side.
It should render as horizontal text on the right side.
It should render as horizontal text on the right side.
It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.
}.


[[break]]

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident.

---

## Section Two

[[margin(left, type: relative, orient: horizontal)]]
{
A **relative horizontal** margin on the left side, tracking section two.
}

Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.

[[break]]

[[margin(left, type: relative, orient: vertical)]]
{
Vertical relative margin
}

Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.

---

## Section Three

[[margin(right, type: relative, orient: horizontal)]]
{
Another right-relative margin. If you have multiple relative margins close together, the collision system should prevent them from overlapping. They should distribute evenly rather than stacking on top of each other.
}

[[margin(right, type: relative, orient: horizontal)]]
{
Second right-relative near the same section. This tests overlap prevention.
}

At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.

[[break]]

Similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga. Et harum quidem rerum facilis est et expedita distinctio.

---

## Section Four

Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor
[[break]]

Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores [[note(bottom, orient: horizontal)]]{repellat}{
This is a **vertical** note with multi-line content.
It should render as horizontal text on the right side.
It should render as horizontal text on the right side.
It should render as horizontal text on the right side.
It should render as horizontal text on the right side.
It should render as horizontal text on the right side.
It should render as horizontal text on the right side.
It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.
}.

---

## Section Five — Inline Notes

This section tests the new [[note(right)]]{inline note syntax}{
A note tracking "inline note syntax" wherever it reflows.
} which lets you anchor margins to specific words.

Here we test [[note(left)]]{multiple notes}{
This left-side note tracks the words "multiple notes".
} appearing near each other to verify [[note(right, orient:horizontal)]]{collision resolution}{
This right-side note tracks "collision resolution" and should not overlap with the one above.
} works correctly.

[[break]]

Testing with multi-line margin content: the word should have a horizontal margin attached to it.

It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.It should render as horizontal text on the right side.
[[break]]

## Image Scatter Test

[[button(action: scatterImage, label: Scatter Image)]]
