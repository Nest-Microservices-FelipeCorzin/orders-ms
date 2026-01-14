import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { PrismaService } from 'src/prisma.service';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { ChangeOrderStatusDto } from './dto';
import { NATS_SERVICE, PRODUCT_SERVICE } from 'src/config';
import { firstValueFrom } from 'rxjs';
import { OrderStatus } from 'src/generated/prisma/enums';


@Injectable()
export class OrdersService {

  constructor(
    private prismaService: PrismaService,
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
  ) {
    // super();
  }
  
  async create(createOrderDto: CreateOrderDto) {
    try {
      //1 Confirmar los ids de los productos
      const productIds = createOrderDto.items.map((item) => item.productId);
      const products: any[] = await firstValueFrom(
        this.client.send({ cmd: 'validate_products' }, productIds),
      );

      //2. Cálculos de los valores
      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.find(
          (product) => product.id === orderItem.productId,
        ).price;
        return price * orderItem.quantity;
      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);

      //3. Crear una transacción de base de datos
      const order = await this.prismaService.order.create({
        data: {
          totalAmount: totalAmount,
          totalItems: totalItems,
          status: OrderStatus.PENDING,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map((orderItem) => ({
                price: products.find(
                  (product) => product.id === orderItem.productId,
                ).price,
                productId: orderItem.productId,
                quantity: orderItem.quantity,
              })),
            },
          },
        },
        include: {
          OrderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true,
            },
          },
        },
      });
      return {
        ...order,
        OrderItem: order.OrderItem.map((orderItem) => ({
          ...orderItem,
          name: products.find((product) => product.id === orderItem.productId)
            .name,
        })),
      };
    } catch (error) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: 'Check logs',
      });
    }
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const totalPages = await this.prismaService.order.count({
      where: {
        status: orderPaginationDto.status
      }
    });

    const currentPage = orderPaginationDto.page;
    const perPage = orderPaginationDto.limit;


    return {
      data: await this.prismaService.order.findMany({
        skip: ( currentPage - 1 ) * perPage,
        take: perPage,
        where: {
          status: orderPaginationDto.status
        }
      }),
      meta: {
        total: totalPages,
        page: currentPage,
        lastPage: Math.ceil( totalPages / perPage )
      }
    }
  }

  async findOne(id: string) {
    const order = await this.prismaService.order.findFirst({
      where: { id },
      include: {
        OrderItem: {
          select: {
            price: true,
            quantity: true,
            productId: true,
          },
        },
      },
    });

    if (!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with id ${id} not found`,
      });
    }

    const productIds = order.OrderItem.map((orderItem) => orderItem.productId);
    const products: any[] = await firstValueFrom(
      this.client.send({ cmd: 'validate_products' }, productIds),
    );

    return {
      ...order,
      OrderItem: order.OrderItem.map((orderItem) => ({
        ...orderItem,
        name: products.find((product) => product.id === orderItem.productId)
          .name,
      })),
    };
  }

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {

    const { id, status } = changeOrderStatusDto;

    const order = await this.findOne(id);
    if ( order.status === status ) {
      return order;
    }

    return this.prismaService.order.update({
      where: { id },
      data: { status: status }
    });


  }
}
