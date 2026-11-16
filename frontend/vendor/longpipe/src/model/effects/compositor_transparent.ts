import type { Backend, Presenter, RenderTarget, Tensor } from '~/model/backend.ts'

// Writes the foreground with the inferred matte as premultiplied RGBA so the
// result can be composed by the editor's 2D canvas without a color fringe.
export class CompositorTransparent {
  private readonly presenter: Presenter

  constructor(backend: Backend, image: Tensor, alpha: Tensor, target: RenderTarget = 'main') {
    this.presenter = backend.presenters.CompositeTransparent(image, alpha, target)
  }

  run(): void {
    this.presenter.run()
  }
}
