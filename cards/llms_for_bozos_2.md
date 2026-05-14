---
name: LLM Inference for Bozos, Part 2
width: 400
height: 400
progressBar: true
wordCount: true
readTime: true
tags: [LLMs, technical], [C++, technical]
date: 04-30-2026
---

# LLM Inference for Bozos, Part 2

[[tags]]
[[date]]    
[[summary]]{Second post in a series where I explore the process of writing a high-performance LLM inference engine from scratch. This post will take the theory learned in the first post and use it to write some surprisingly simple code to infer Llama 3.2 1B.}
[[toc]]
---

## Background
[[drop(I)]]n the [[lms_for_bozos_1|last post ]] we built up the intuition for how transformers work: how tokens flow through the attention, gain context, pass through feed-forward networks, and eventually produce a next token. [[note(left, orient:horizontal, type:relative)]]{}{The last post assumes you have no knowledge of machine learning, largely just linear algebra. If you feel you have the relevant theoretical background of how a transformer works but want to bridge the implementation gap, this is the perfect place to jump in.} Everything was described high-level, in terms of geometry and linear algebra. Now that we have the necessary background, we are going to start writing inference code. We will download Llama 3.2 1B's weights from Hugging Face, figure out what the model looks like on disk, and in plain C++ implement the steps we described in the previous post to infer the model. 

[[bigbreak]]
## Huggingface